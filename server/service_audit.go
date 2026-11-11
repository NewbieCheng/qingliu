package main

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"time"
)

// requireServiceAuth 校验工作台服务间调用。
//
// 清流与工作台共用一对 WORKBENCH_SERVICE_CLIENT / WORKBENCH_SERVICE_SECRET：
// 清流调工作台时带这对头；工作台回调清流（读/清操作记录）也带同一对。
// 不另起密钥，避免两边各维护一份然后漂移。
func (a *App) requireServiceAuth(q *request) {
	if !a.wb.Ready() {
		bad(503, "Workbench is not connected")
	}
	client := strings.TrimSpace(q.r.Header.Get("X-Service-Client"))
	secret := strings.TrimSpace(q.r.Header.Get("X-Service-Secret"))
	if client == "" || secret == "" {
		bad(401, "缺少服务凭证")
	}
	if subtle.ConstantTimeCompare([]byte(client), []byte(a.wb.ClientID)) != 1 ||
		subtle.ConstantTimeCompare([]byte(secret), []byte(a.wb.Secret)) != 1 {
		bad(401, "服务凭证无效")
	}
}

func isServiceAPI(path string) bool {
	return strings.HasPrefix(path, "/api/service/")
}

// serviceAuditEventsPage 是给工作台平台运维看的全库视图：
// 不按会话空间收口（调用方已是服务身份），但仍支持 action / 搜索 / 时间窗分页。
func serviceAuditEventsPage(s *Store, query auditQuery) Object {
	where := []string{"1=1"}
	args := []any{}
	if query.Action != "" {
		where = append(where, "e.action=?")
		args = append(args, query.Action)
	}
	if query.UserID != "" {
		where = append(where, "e.user_id=?")
		args = append(args, query.UserID)
	}
	if query.Search != "" {
		where = append(where, "(e.detail LIKE ? OR u.display LIKE ? OR e.action LIKE ? OR u.username LIKE ? OR c.name LIKE ?)")
		like := "%" + query.Search + "%"
		args = append(args, like, like, like, like, like)
	}
	if query.From != "" {
		where = append(where, "e.created>=?")
		args = append(args, query.From)
	}
	if query.To != "" {
		where = append(where, "e.created<?")
		args = append(args, query.To)
	}
	clause := strings.Join(where, " AND ")
	from := "FROM ql_events e LEFT JOIN ql_users u ON e.user_id=u.id LEFT JOIN ql_customers c ON e.customer_id=c.id"
	total := s.one(
		"SELECT COUNT(*) AS n "+from+" WHERE "+clause,
		args...,
	)
	pageArgs := append(append([]any{}, args...), query.PageSize, (query.Page-1)*query.PageSize)
	events := s.query(
		"SELECT e.seq,e.user_id,e.customer_id,e.action,e.detail,e.created,e.space_kind,e.space_id,u.display,u.username,c.name AS customer_name "+
			from+" WHERE "+clause+
			" ORDER BY e.seq DESC LIMIT ? OFFSET ?",
		pageArgs...,
	)
	for _, event := range events {
		enrichAuditEvent(event)
	}
	summaryRows := s.query(
		"SELECT e.action AS action, COUNT(*) AS n FROM ql_events e GROUP BY e.action ORDER BY n DESC",
	)
	summary := make([]Object, 0, len(summaryRows))
	for _, row := range summaryRows {
		action := str(row, "action")
		summary = append(summary, Object{
			"action": action,
			"label":  auditActionLabel(action),
			"count":  integer(row["n"]),
		})
	}
	keepDays, loginDays := auditRetentionDays()
	return Object{
		"events":               events,
		"count":                integer(total["n"]),
		"page":                 query.Page,
		"page_size":            query.PageSize,
		"actions":              auditActionOptions(),
		"summary":              summary,
		"retention_days":       keepDays,
		"login_retention_days": loginDays,
	}
}

func (a *App) registerServiceAuditRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/service/audit", a.route(func(q *request) {
		a.requireServiceAuth(q)
		query := parseAuditQuery(q)
		require(len(query.Search) <= 120, "Search text too long")
		q.json(serviceAuditEventsPage(a.s, query))
	}))
	m.HandleFunc("POST /api/service/audit/purge", a.route(func(q *request) {
		a.requireServiceAuth(q)
		deleted := a.s.purgeAuditEvents(time.Now())
		q.json(Object{"ok": true, "deleted": deleted})
	}))
}
