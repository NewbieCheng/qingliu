// spaces.go 是「空间」的**透传**层：清流不判断「谁能进哪个空间」，只转发问题。
//
// # 为什么删掉原来那份实现
//
// 改造前 space.go 里有一段清流自有的空间实现：把空间存成会话上的一个整数
// tenant_id（0=个人、>0=企业），再由 scopeWhere 拿它拼 SQL。工作台把空间重构成
//
//	kind ∈ personal|team|platform  +  id
//
// 之后，「一个整数」表达不了三种空间，清流那份实现就只剩两种选择：漏掉平台
// 空间，或者自己再发明一套映射。两者都会让两个系统对「这个人在哪个空间」有
// 两张不同的答案 —— 而空间决定的是**谁能看谁的资料**，不能有两张答案。
//
// # 现在的分工
//
//   - 谁能进哪个空间：工作台算（GET /api/v1/me/spaces，依据 t_space_membership），
//     清流原样透传，连名字和角色标签都不自己拼。
//   - 这个会话现在在哪个空间：清流自己的 ql_sessions.space_kind/space_id。
//     切空间只改本会话一行，不动账号 —— 换台设备登录仍落在默认空间。
//
// # 平台空间
//
// 清流是业务流程产品，没有「平台运营」视图，因此**不提供**切进平台空间的入口
// （切进来只会看到一个空壳）。列表里仍然显示它，让用户知道这个入口存在、且归
// 工作台管；真要进平台空间请在工作台里切。
package main

import (
	"net/http"
	"strings"
	"time"
)

// 空间 kind 的取值，与工作台契约（space.SpaceKind）一字不差。
const (
	spacePersonal = "personal"
	spaceTeam     = "team"
	spacePlatform = "platform"
)

// spaceRef 是「一个空间」的最小表示。工作台契约里就是 kind + id：三种空间
// 无法用一个 tenant_id 表达，所以清流的会话也按同一个形状存。
type spaceRef struct {
	Kind string
	ID   int64
}

// normalizeSpaceKind 收敛旧的 'enterprise' 说法。
//
// 工作台早期把团队空间叫 enterprise，现在统一叫 team；清流前端产物、书签里
// 的旧值还可能带过来。认不出的值一律当个人空间 —— 「未知空间」绝不能落到
// 团队分支上，那等于给所有人开本企业资料。
func normalizeSpaceKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case spaceTeam, "enterprise":
		return spaceTeam
	case spacePlatform:
		return spacePlatform
	default:
		return spacePersonal
	}
}

// spaceOf 从一行数据（会话行 / 任务行）里读出空间坐标。
func spaceOf(row Object) spaceRef {
	space := spaceRef{Kind: normalizeSpaceKind(str(row, "space_kind")), ID: integer(row["space_id"])}
	if space.Kind == spacePersonal {
		// 个人空间的 id 恒等于账号本身，本地不需要记（资料隔离按 owner_user_id 判）。
		space.ID = 0
	}
	return space
}

// Object 把空间折成前端/工作台通用的形状。
func (s spaceRef) Object() Object {
	return Object{"kind": s.Kind, "id": s.ID}
}

// teamID 返回资料归属用的团队 id：只有团队空间才有，个人/平台都是 0。
func (s spaceRef) teamID() int64 {
	if s.Kind == spaceTeam {
		return s.ID
	}
	return 0
}

// spaces 透传「这个人能进的空间」，并把 current 改成**本会话**实际所在的空间。
//
// 工作台标的 current 是「它那份 access token 所在的空间」。清流把工作台令牌
// 存在账号上（一个账号一份，多设备共用），而资料隔离按会话空间判。两处不一致
// 时界面会说「你当前在 A」，实际看到的是 B 的资料 —— 这是最难解释的一类错，
// 所以 current 以会话为准。
func (a *App) spaces(q *request) Object {
	current := q.space()
	status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, "/api/v1/me/spaces", nil)
	if err != nil || status != http.StatusOK {
		// 读不到就只回「当前空间」：界面仍然能显示自己在哪，只是不能切 ——
		// 比整页报错好，也比假装能切好。
		return Object{"items": []Object{currentSpaceItem(current)}, "current_space": current.Object(), "warn": "暂无多余空间"}
	}
	items := spaceItems(data)
	out := make([]Object, 0, len(items))
	seenCurrent := false
	for _, item := range items {
		entry := Object{
			"kind":       normalizeSpaceKind(str(item, "kind")),
			"id":         integer(item["id"]),
			"name":       strings.TrimSpace(str(item, "name")),
			"role":       integer(item["role"]),
			"role_label": strings.TrimSpace(str(item, "role_label")),
			"status":     spaceStatus(str(item, "status")),
			"can_enable": yes(item, "can_enable"),
			"home":       yes(item, "home"),
			"current":    false,
		}
		entry["current"] = sameSpace(spaceRef{Kind: str(entry, "kind"), ID: integer(entry["id"])}, current)
		if yes(entry, "current") {
			seenCurrent = true
		}
		out = append(out, entry)
	}
	if !seenCurrent {
		// 当前空间不在列表里（例如刚被移出企业）：仍然要显示出来，
		// 否则用户看到的是一个「哪项都不是当前」的列表，无法解释。
		out = append(out, currentSpaceItem(current))
	}
	return Object{"items": out, "current_space": current.Object()}
}

// spaceItems 把工作台响应折成条目列表（兼容 {data:{...}} 与裸对象两种外形）。
func spaceItems(data Object) []Object {
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	raw, _ := payload["items"].([]any)
	out := make([]Object, 0, len(raw))
	for _, value := range raw {
		if item, ok := value.(map[string]any); ok {
			out = append(out, item)
		}
	}
	return out
}

// spaceStatus 收敛状态取值：enabled（可切）/ locked（要先开启）/ removed（已移除）。
func spaceStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "locked":
		return "locked"
	case "removed":
		return "removed"
	default:
		return "enabled"
	}
}

func sameSpace(a, b spaceRef) bool {
	return a.Kind == b.Kind && (a.Kind == spacePersonal || a.ID == b.ID)
}

// currentSpaceItem 只描述「本会话当前所在的空间」，用于工作台不可达或列表缺项。
func currentSpaceItem(current spaceRef) Object {
	return Object{
		"kind": current.Kind, "id": current.ID, "name": spaceFallbackName(current),
		"role": 0, "role_label": "", "status": "enabled",
		"can_enable": false, "current": true, "home": false,
	}
}

// spaceFallbackName 是拿不到工作台名字时的兜底显示。
func spaceFallbackName(space spaceRef) string {
	switch space.Kind {
	case spaceTeam:
		return "团队 #" + itoa(space.ID)
	case spacePlatform:
		return "平台空间"
	default:
		return "个人空间"
	}
}

// spaceTarget 解析切换/开启请求里的目标空间。
//
// 形状是工作台的 {kind,id}；同时接受旧的 {tenant_id}（0=个人、>0=团队），
// 只是因为线上的前端产物还没全部换新，旧字段等价于 {kind:"team",id:tenant_id}。
func spaceTarget(body Object) spaceRef {
	kind := strings.TrimSpace(str(body, "kind"))
	if kind == "" {
		if body["tenant_id"] == nil {
			bad(400, "请指定要切换的空间")
		}
		if tenant := integer(body["tenant_id"]); tenant > 0 {
			return spaceRef{Kind: spaceTeam, ID: tenant}
		}
		return spaceRef{Kind: spacePersonal}
	}
	target := spaceRef{Kind: normalizeSpaceKind(kind), ID: integer(body["id"])}
	if target.Kind == spacePersonal {
		target.ID = 0
	}
	if target.Kind != spacePersonal && target.ID <= 0 {
		bad(400, "请指定要切换的空间")
	}
	return target
}

// switchSpace 转发给工作台，并把本会话的空间改成目标空间。
//
// 顺序是刻意的：先问工作台「他能不能进这个空间」，再写库。清流不是权限的
// 裁判，只保存用户的选择；工作台拒绝时原样透传它的拒绝（403/409），
// 而不是自己猜。
func (a *App) switchSpace(q *request) Object {
	target := spaceTarget(q.body())
	if target.Kind == spacePlatform {
		// 见文件头：清流没有平台视图，切进来只会看到一个空壳。
		bad(400, "清流暂不支持平台空间，请在工作台里切换")
	}
	uid := str(q.user, "id")
	status, data, err := a.wbRequest(q.r.Context(), uid, http.MethodPost, "/api/v1/me/switch-space", target.Object())
	if err != nil {
		bad(503, "暂时无法切换空间，请稍后重试")
	}
	if status < 200 || status >= 300 {
		bad(status, wbMessage(data, "这个账号不属于该空间"))
	}
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	// 工作台会换发一个属于新空间的 access token。有就顺手换掉：令牌里带着
	// 空间声明，留着旧的会让后续调工作台仍按旧空间扣费与授权。
	if token := strings.TrimSpace(str(payload, "access_token")); token != "" {
		a.s.exec("UPDATE ql_workbench_accounts SET access_token=?, token_expires=? WHERE user_id=?",
			a.s.seal([]byte(token)), expiresAtUnix(payload), uid)
	}
	// 只改本会话一行：换个浏览器登录仍落在默认空间 —— 这是「临时切过去看一眼」
	// 而不是「永久换身份」。
	a.s.exec("UPDATE ql_sessions SET space_kind=?, space_id=? WHERE token=?",
		target.Kind, target.ID, str(q.session, "token"))
	a.s.event(target, uid, "", "switch_space", target.Kind+":"+itoa(target.ID))
	q.session["space_kind"], q.session["space_id"] = target.Kind, target.ID
	return Object{"ok": true, "space": a.spaceDetail(q.r, uid, target)}
}

// enableSpace 透传「开启一个空间」（locked → enabled）。
//
// 清流不解释「为什么这个空间需要开启」：那是工作台的成员关系与准入规则。
// 开启成功后返回最新列表，前端可直接重绘（避免再发一次 GET）。
func (a *App) enableSpace(q *request) Object {
	target := spaceTarget(q.body())
	if target.Kind == spacePlatform {
		bad(400, "平台空间只能由平台管理员在工作台开启")
	}
	status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodPost, "/api/v1/me/spaces/enable", target.Object())
	if err != nil {
		bad(503, "暂时无法开启空间，请稍后重试")
	}
	if status < 200 || status >= 300 {
		bad(status, wbMessage(data, "无法开启这个空间"))
	}
	a.s.event(target, str(q.user, "id"), "", "enable_space", target.Kind+":"+itoa(target.ID))
	return a.spaces(q)
}

// spaceDetail 描述切换后的空间：名字与角色标签仍然来自工作台。
func (a *App) spaceDetail(r *http.Request, userID string, target spaceRef) Object {
	name, label := a.spaceLabel(r.Context(), userID, target)
	return Object{
		"kind": target.Kind, "id": target.ID, "name": name,
		"role_label": label, "current": true,
	}
}

// expiresAtUnix 读工作台返回的令牌过期时间。
//
// 工作台发的是 RFC3339 的 expires_at（早期字段名是 expires_at_unix，值是整数）。
// 两种都读：读不到就返回 0，让 wbAccessToken 按「已过期」处理并刷新一次 ——
// 宁可多刷一次，也不要拿一个过期时间留在一个**新**令牌上。
func expiresAtUnix(payload Object) int64 {
	if raw := str(payload, "expires_at"); raw != "" {
		if at, err := time.Parse(time.RFC3339, raw); err == nil {
			return at.Unix()
		}
	}
	return integer(payload["expires_at_unix"])
}
