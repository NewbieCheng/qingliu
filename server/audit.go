package main

import (
	"strconv"
	"strings"
	"time"
)

const (
	auditDefaultPageSize = 20
	auditMaxPageSize     = 100
)

type auditActionMeta struct {
	Label    string `json:"label"`
	Category string `json:"category"`
}

// auditActionCatalog keeps operator-facing labels out of SQL and gives the UI
// one stable vocabulary for filtering and display.
var auditActionCatalog = map[string]auditActionMeta{
	"login":               {Label: "登录", Category: "account"},
	"change_password":     {Label: "修改密码", Category: "account"},
	"create_customer":     {Label: "新建客户", Category: "customer"},
	"upload_queued":       {Label: "上传资料", Category: "customer"},
	"upload_finished":     {Label: "资料识别完成", Category: "customer"},
	"confirm_ownership":   {Label: "确认归属", Category: "customer"},
	"confirm_period":      {Label: "确认期间", Category: "customer"},
	"update_rules":        {Label: "更新规则", Category: "customer"},
	"review_transactions": {Label: "核对交易", Category: "customer"},
	"view_original":       {Label: "查看原件", Category: "customer"},
	"view_original_page":  {Label: "查看原页", Category: "customer"},
	"submit_review":       {Label: "提交复核", Category: "customer"},
	"report_queued":       {Label: "生成报告", Category: "customer"},
	"report_finished":     {Label: "报告完成", Category: "customer"},
	"download_report":     {Label: "下载报告", Category: "customer"},
	"add_user":            {Label: "新增成员", Category: "admin"},
	"toggle_user":         {Label: "启停成员", Category: "admin"},
	"change_grant":        {Label: "调整客户权限", Category: "admin"},
}

func auditActionLabel(action string) string {
	if meta, ok := auditActionCatalog[action]; ok {
		return meta.Label
	}
	return action
}

func auditActionOptions() []Object {
	out := []Object{}
	order := []string{
		"login", "change_password",
		"create_customer", "upload_queued", "upload_finished",
		"confirm_ownership", "confirm_period", "update_rules",
		"review_transactions", "view_original", "view_original_page",
		"submit_review", "report_queued", "report_finished", "download_report",
		"add_user", "toggle_user", "change_grant",
	}
	for _, key := range order {
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

// auditFilter builds a bounded WHERE clause. Callers must append bound values
// in the same order as the placeholders below.
func (a auditQuery) filter() (string, []any) {
	where := []string{"1=1"}
	args := []any{}
	if a.Action != "" {
		where = append(where, "e.action=?")
		args = append(args, a.Action)
	}
	if a.UserID != "" {
		where = append(where, "e.user_id=?")
		args = append(args, a.UserID)
	}
	if a.Search != "" {
		where = append(where, "(e.detail LIKE ? OR u.display LIKE ? OR e.action LIKE ?)")
		like := "%" + a.Search + "%"
		args = append(args, like, like, like)
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
	total := s.one(
		"SELECT COUNT(*) AS n FROM ql_events e LEFT JOIN ql_users u ON e.user_id=u.id WHERE "+where,
		args...,
	)
	pageArgs := append(append([]any{}, args...), query.PageSize, (query.Page-1)*query.PageSize)
	events := s.query(
		"SELECT e.seq,e.user_id,e.customer_id,e.action,e.detail,e.created,u.display "+
			"FROM ql_events e LEFT JOIN ql_users u ON e.user_id=u.id WHERE "+where+
			" ORDER BY e.seq DESC LIMIT ? OFFSET ?",
		pageArgs...,
	)
	for _, event := range events {
		action := str(event, "action")
		meta, ok := auditActionCatalog[action]
		if !ok {
			meta = auditActionMeta{Label: action, Category: "other"}
		}
		event["action_label"] = meta.Label
		event["category"] = meta.Category
	}
	return Object{"events": events, "count": integer(total["n"]), "page": query.Page, "page_size": query.PageSize}
}
