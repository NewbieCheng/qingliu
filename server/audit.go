package main

import (
	"context"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	auditDefaultPageSize = 10
	auditMaxPageSize     = 100

	auditDefaultRetentionDays      = 90
	auditDefaultLoginRetentionDays = 30
)

type auditActionMeta struct {
	Label    string `json:"label"`
	Category string `json:"category"`
}

// auditActionCatalog 是操作记录的唯一词表：
//   - 写入闸门（auditShouldPersist）只放行这里的 key；
//   - 管理台筛选下拉与 action_label 也只来自这里。
// 噪音动作（切空间、翻原件、任务 *_finished / AI 进度）不进目录，也就不会落库。
var auditActionCatalog = map[string]auditActionMeta{
	"login":               {Label: "登录", Category: "account"},
	"change_password":     {Label: "修改密码", Category: "account"},
	"enable_space":        {Label: "开启空间", Category: "account"},
	"create_customer":     {Label: "新建客户", Category: "customer"},
	"upload_queued":       {Label: "上传资料", Category: "customer"},
	"confirm_ownership":   {Label: "确认归属", Category: "customer"},
	"confirm_period":      {Label: "确认期间", Category: "customer"},
	"update_rules":        {Label: "更新规则", Category: "customer"},
	"review_transactions": {Label: "核对交易", Category: "customer"},
	"submit_review":       {Label: "提交复核", Category: "customer"},
	"report_queued":       {Label: "生成报告", Category: "customer"},
	"download_report":     {Label: "下载报告", Category: "customer"},
	"job_cancelled":       {Label: "取消任务", Category: "customer"},
	"add_user":            {Label: "新增成员", Category: "admin"},
	"toggle_user":         {Label: "启停成员", Category: "admin"},
	"remove_user":         {Label: "删除成员", Category: "admin"},
	"change_grant":        {Label: "调整客户权限", Category: "admin"},
}

// auditActionOrder 控制筛选下拉里的展示顺序。
var auditActionOrder = []string{
	"login", "change_password", "enable_space",
	"create_customer", "upload_queued",
	"confirm_ownership", "confirm_period", "update_rules",
	"review_transactions", "submit_review",
	"report_queued", "download_report", "job_cancelled",
	"add_user", "toggle_user", "remove_user", "change_grant",
}

// auditNoiseActions 是历史上写过、现在要清掉的噪音码。
// 新写入靠白名单拦截；这里只服务 purge。
var auditNoiseActions = []string{
	"switch_space",
	"view_original",
	"view_original_page",
	"upload_finished",
	"report_finished",
	"ai_analysis_queued",
	"ai_analysis_finished",
	"job_timeout",
}

func auditShouldPersist(action string) bool {
	_, ok := auditActionCatalog[strings.TrimSpace(action)]
	return ok
}

func auditActionLabel(action string) string {
	if meta, ok := auditActionCatalog[action]; ok {
		return meta.Label
	}
	return action
}

// auditSpaceDetailLabel 把 login / enable_space 写入的 "team:2" 翻成可读空间名。
// 不回传数字 id：对管理员而言「进了哪个团队」看会话即可，详情列只说空间类型。
func auditSpaceDetailLabel(detail string) string {
	kind, _, _ := strings.Cut(strings.TrimSpace(detail), ":")
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case spaceTeam, "enterprise":
		return "团队空间"
	case spacePlatform:
		return "平台空间"
	case spacePersonal:
		return "个人空间"
	case "":
		return ""
	default:
		return "工作空间"
	}
}

func auditReportFileLabel(detail string) string {
	name := strings.TrimSpace(detail)
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	switch name {
	case "report.pdf":
		return "PDF 报告"
	case "report.html":
		return "网页报告"
	case "summary.xlsx":
		return "汇总表"
	case "detail.xlsx":
		return "明细表"
	case "":
		return "下载报告"
	default:
		return "报告文件"
	}
}

// auditDetailLabel 把库里的技术 detail 翻成管理页可读文案。
// 原始 detail 仍返回给排查用途；界面优先用 detail_label。
func auditDetailLabel(action, detail string) string {
	detail = strings.TrimSpace(detail)
	switch action {
	case "login", "enable_space", "switch_space":
		return auditSpaceDetailLabel(detail)
	case "download_report":
		return auditReportFileLabel(detail)
	case "upload_queued":
		if detail == "" {
			return "已上传资料"
		}
		return "上传 " + detail + " 份资料"
	case "review_transactions":
		if detail == "" {
			return "已核对交易"
		}
		return "核对 " + detail + " 笔"
	case "confirm_period":
		return "已确认统计期间"
	case "change_password":
		if detail == "workbench" {
			return "工作台账号"
		}
		if detail == "" {
			return "本系统账号"
		}
		return detail
	case "change_grant":
		return "已调整授权"
	case "report_queued":
		return "报告已排队"
	case "job_cancelled":
		return "任务已取消"
	case "add_user":
		if detail != "" {
			return detail
		}
		return "新成员"
	case "toggle_user":
		return "已切换启停"
	case "create_customer", "confirm_ownership", "update_rules", "submit_review":
		return ""
	default:
		return detail
	}
}

func enrichAuditEvent(event Object) {
	action := str(event, "action")
	meta, ok := auditActionCatalog[action]
	if !ok {
		meta = auditActionMeta{Label: action, Category: "other"}
	}
	event["action_label"] = meta.Label
	event["category"] = meta.Category
	event["detail_label"] = auditDetailLabel(action, str(event, "detail"))
	if name := strings.TrimSpace(str(event, "customer_name")); name != "" {
		event["customer_name"] = name
	}
}

func auditActionOptions() []Object {
	out := make([]Object, 0, len(auditActionOrder))
	for _, key := range auditActionOrder {
		meta := auditActionCatalog[key]
		out = append(out, Object{"value": key, "label": meta.Label, "category": meta.Category})
	}
	return out
}

type auditQuery struct {
	Page     int
	PageSize int
	Action   string
	UserID   string
	Search   string
	From     string
	To       string
	// Space / Actor 由 handler 注入：操作记录必须按当前会话空间收口。
	Space spaceRef
	Actor string
}

func normalizeAuditTime(value string) string {
	if value == "" {
		return ""
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC().Format("2006-01-02 15:04:05")
		}
	}
	return ""
}

func parseAuditQuery(q *request) auditQuery {
	values := q.r.URL.Query()
	page, _ := strconv.Atoi(values.Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(values.Get("page_size"))
	if pageSize < 1 {
		pageSize = auditDefaultPageSize
	}
	if pageSize > auditMaxPageSize {
		pageSize = auditMaxPageSize
	}
	action := strings.TrimSpace(values.Get("action"))
	if _, ok := auditActionCatalog[action]; !ok {
		action = ""
	}
	return auditQuery{
		Page:     page,
		PageSize: pageSize,
		Action:   action,
		UserID:   strings.TrimSpace(values.Get("user_id")),
		Search:   strings.TrimSpace(values.Get("q")),
		From:     normalizeAuditTime(values.Get("from")),
		To:       normalizeAuditTime(values.Get("to")),
	}
}

// auditSpaceFilter 是操作记录的硬边界：团队空间看本团队全部成员；
// 个人/平台空间只看自己。缺会话空间或演员时返回恒假，避免退回全库。
func auditSpaceFilter(space spaceRef, actor string) (string, []any) {
	space = spaceOf(Object{"space_kind": space.Kind, "space_id": space.ID})
	actor = strings.TrimSpace(actor)
	if actor == "" {
		return "1=0", nil
	}
	switch space.Kind {
	case spaceTeam:
		if space.ID <= 0 {
			return "1=0", nil
		}
		return "e.space_kind=? AND e.space_id=?", []any{spaceTeam, space.ID}
	default:
		return "e.space_kind=? AND e.space_id=? AND e.user_id=?", []any{space.Kind, space.ID, actor}
	}
}

func (a auditQuery) filter() (string, []any) {
	spaceWhere, spaceArgs := auditSpaceFilter(a.Space, a.Actor)
	where := []string{spaceWhere}
	args := append([]any{}, spaceArgs...)
	if a.Action != "" {
		where = append(where, "e.action=?")
		args = append(args, a.Action)
	}
	if a.UserID != "" {
		where = append(where, "e.user_id=?")
		args = append(args, a.UserID)
	}
	if a.Search != "" {
		where = append(where, "(e.detail LIKE ? OR u.display LIKE ? OR e.action LIKE ? OR c.name LIKE ?)")
		like := "%" + a.Search + "%"
		args = append(args, like, like, like, like)
	}
	if a.From != "" {
		where = append(where, "e.created>=?")
		args = append(args, a.From)
	}
	if a.To != "" {
		where = append(where, "e.created<?")
		args = append(args, a.To)
	}
	return strings.Join(where, " AND "), args
}

func auditEventsPage(s *Store, query auditQuery) Object {
	where, args := query.filter()
	from := "FROM ql_events e LEFT JOIN ql_users u ON e.user_id=u.id LEFT JOIN ql_customers c ON e.customer_id=c.id"
	total := s.one(
		"SELECT COUNT(*) AS n "+from+" WHERE "+where,
		args...,
	)
	pageArgs := append(append([]any{}, args...), query.PageSize, (query.Page-1)*query.PageSize)
	events := s.query(
		"SELECT e.seq,e.user_id,e.customer_id,e.action,e.detail,e.created,u.display,c.name AS customer_name "+
			from+" WHERE "+where+
			" ORDER BY e.seq DESC LIMIT ? OFFSET ?",
		pageArgs...,
	)
	for _, event := range events {
		enrichAuditEvent(event)
	}
	return Object{"events": events, "count": integer(total["n"]), "page": query.Page, "page_size": query.PageSize}
}

func auditRetentionDays() (keep, loginKeep int) {
	keep = envInt("AUDIT_RETENTION_DAYS", auditDefaultRetentionDays)
	loginKeep = envInt("AUDIT_LOGIN_RETENTION_DAYS", auditDefaultLoginRetentionDays)
	if keep < 1 {
		keep = auditDefaultRetentionDays
	}
	if loginKeep < 1 {
		loginKeep = auditDefaultLoginRetentionDays
	}
	if loginKeep > keep {
		loginKeep = keep
	}
	return keep, loginKeep
}

func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

// purgeAuditEvents 删三类东西：历史噪音 action、过期 login、过期其它保留事件。
// 返回删除行数；调用方负责打日志。失败直接 panic 给上层 recover（与其它 Store 写路径一致）。
func (s *Store) purgeAuditEvents(now time.Time) int64 {
	keepDays, loginDays := auditRetentionDays()
	cutoff := now.UTC().AddDate(0, 0, -keepDays).Format("2006-01-02 15:04:05")
	loginCutoff := now.UTC().AddDate(0, 0, -loginDays).Format("2006-01-02 15:04:05")

	var total int64
	if len(auditNoiseActions) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(auditNoiseActions)), ",")
		args := make([]any, 0, len(auditNoiseActions))
		for _, action := range auditNoiseActions {
			args = append(args, action)
		}
		res, err := s.db.Exec("DELETE FROM ql_events WHERE action IN ("+placeholders+")", args...)
		if err != nil {
			panic(err)
		}
		n, _ := res.RowsAffected()
		total += n
	}
	res, err := s.db.Exec("DELETE FROM ql_events WHERE action=? AND created<?", "login", loginCutoff)
	if err != nil {
		panic(err)
	}
	n, _ := res.RowsAffected()
	total += n
	res, err = s.db.Exec("DELETE FROM ql_events WHERE action<>? AND created<?", "login", cutoff)
	if err != nil {
		panic(err)
	}
	n, _ = res.RowsAffected()
	total += n
	return total
}

// startAuditRetention 启动时先清一轮，之后每小时再清。ctx 取消即停。
func startAuditRetention(ctx context.Context, s *Store) {
	run := func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("audit purge failed: %v", rec)
			}
		}()
		if n := s.purgeAuditEvents(time.Now()); n > 0 {
			log.Printf("audit purged %d rows", n)
		}
	}
	run()
	ticker := time.NewTicker(time.Hour)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}
