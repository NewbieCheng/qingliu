// space.go 是「空间切换」：一个人可以在自己的个人空间与所属企业之间来回切。
//
// # 为什么需要它
//
// 改造前 ql_users.tenant_id 在**登录时**就定死了，一个人只能属于一个空间。
// 而工作台里同一个人可能同时是「某企业的成员」和「自己的个人账号」，
// 清流这边于是只能二选一，切不了。
//
// # 做法
//
// 空间存在**会话**上（ql_sessions.tenant_id，见 migrations/004），
// scopeWhere 读会话而不是读用户列。切换只改本会话那一行，换个浏览器登录
// 仍然落在默认空间 —— 这是「临时切过去看一眼」而不是「永久换身份」。
//
// # 凭什么相信他能进这个空间
//
// 不清流自己判断，问工作台：GET /api/v1/me/spaces 由工作台按 t_tenant_membership
// 与主身份算出来（见工作台 internal/auth/space.go）。清流只做缓存与选择，
// 因此两个系统对「谁能进哪个企业」永远只有一份答案。
package main

import (
	"net/http"
	"strings"
)

// spaces 返回这个人能进的空间，当前空间打上 current。
func (a *App) spaces(q *request) Object {
	status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, "/api/v1/me/spaces", nil)
	if err != nil || status != http.StatusOK {
		// 读不到就只回「当前空间」：界面仍然能显示自己在哪，
		// 只是不能切 —— 比整页报错好，也比假装能切好。
		return Object{"items": []Object{a.currentSpace(q)}, "warn": "暂时读不到可用的团队列表"}
	}
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	items, _ := payload["items"].([]any)
	out := make([]Object, 0, len(items))
	current := a.currentSpace(q)
	seenCurrent := false
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		entry := Object{
			"tenant_id":   integer(item["tenant_id"]),
			"tenant_name": str(item, "tenant_name"),
			"role_label":  str(item, "role_label"),
			"personal":    yes(item, "personal"),
			"current":     integer(item["tenant_id"]) == integer(current["tenant_id"]),
		}
		if yes(entry, "current") {
			seenCurrent = true
		}
		out = append(out, entry)
	}
	if !seenCurrent {
		// 当前空间不在列表里（例如刚被移出企业）：仍然要显示出来，
		// 否则用户看到的是一个「哪项都不是当前」的列表，无法解释。
		out = append(out, current)
	}
	return Object{"items": out}
}

// currentSpace 描述本会话当前所在的空间。
func (a *App) currentSpace(q *request) Object {
	tenant := integer(q.session["tenant_id"])
	name := ""
	label := "个人空间"
	if tenant > 0 {
		// 刻意**不**调 /api/v1/tenant/info：那个接口按当前令牌的空间返回名字，
		// 用它去命名另一个空间会显示成错误的公司。名字由工作台的 /me/spaces
		// 提供（那里带着 tenant_name），拿不到时显示「企业 #id」。
		name = "企业 #" + itoa(tenant)
		label = "企业空间"
	}
	return Object{
		"tenant_id": tenant, "tenant_name": name, "scope": label,
		"current": true, "personal": tenant == 0,
	}
}

// switchSpace 改写本会话的空间。
//
// 先问工作台「他能不能进这个空间」，再写库：清流不是权限的裁判，
// 只保存用户的选择。工作台拒绝时原样透传它的拒绝（403/404），
// 而不是自己猜。
func (a *App) switchSpace(q *request) Object {
	b := q.body()
	target := integer(b["tenant_id"])
	uid := str(q.user, "id")
	status, data, err := a.wbRequest(q.r.Context(), uid, http.MethodPost, "/api/v1/me/switch-space", Object{"tenant_id": target})
	if err != nil {
		bad(503, "暂时无法切换空间，请稍后重试")
	}
	if status < 200 || status >= 300 {
		message := wbMessage(data, "这个账号不属于该空间")
		// 工作台可能同时换发一个新的 access token（空间变了，令牌里的
		// tenant_id 也要跟着变）。有就顺手换掉，否则后续调工作台接口
		// 仍会按旧空间扣费。
		bad(status, message)
	}
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	if token := strings.TrimSpace(str(payload, "access_token")); token != "" {
		a.s.exec("UPDATE ql_workbench_accounts SET access_token=?, token_expires=? WHERE user_id=?",
			a.s.seal([]byte(token)), integer(payload["expires_at_unix"]), uid)
	}
	a.s.exec("UPDATE ql_sessions SET tenant_id=? WHERE token=?", target, str(q.session, "token"))
	a.s.event(uid, "", "switch_space", itoa(target))
	// 回读会话行，让前端拿到切换后的真实状态（而不是它自己猜的）。
	q.session["tenant_id"] = target
	return Object{"ok": true, "space": a.currentSpace(q)}
}
