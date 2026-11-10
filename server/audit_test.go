package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseAuditQueryBoundsAndFilters(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/admin/audit?page=-2&page_size=999&action=login&user_id=u1&q=%E5%90%88%E6%88%90&from=2026-01-01&to=2026-02-01", nil)
	q := parseAuditQuery(&request{r: r})
	q.Space = spaceRef{Kind: spacePersonal, ID: 0}
	q.Actor = "actor-1"
	if q.Page != 1 {
		t.Fatalf("page = %d", q.Page)
	}
	if q.PageSize != auditMaxPageSize {
		t.Fatalf("page_size = %d", q.PageSize)
	}
	if q.Action != "login" || q.UserID != "u1" || q.Search != "合成" {
		t.Fatalf("query = %+v", q)
	}
	where, args := q.filter()
	// 断言的是「占位符数量 == 绑定参数数量」这条不变式，而不是某个写死的数字。
	// 之前写死 5，filter 后来多了一个 e.action LIKE ? 就变成假红。
	if where == "1=1" || !strings.Contains(where, "e.space_kind=?") {
		t.Fatalf("filter = %q", where)
	}
	if placeholders := strings.Count(where, "?"); placeholders != len(args) {
		t.Fatalf("placeholder/arg mismatch: %d placeholders vs %d args; filter=%q args=%v",
			placeholders, len(args), where, args)
	}
}

func TestAuditSpaceFilterScopesBySpace(t *testing.T) {
	teamWhere, teamArgs := auditSpaceFilter(spaceRef{Kind: spaceTeam, ID: 42}, "u1")
	if teamWhere != "e.space_kind=? AND e.space_id=?" || len(teamArgs) != 2 || teamArgs[0] != spaceTeam || teamArgs[1] != int64(42) {
		t.Fatalf("team filter = %q %v", teamWhere, teamArgs)
	}
	personalWhere, personalArgs := auditSpaceFilter(spaceRef{Kind: spacePersonal, ID: 99}, "u1")
	if personalWhere != "e.space_kind=? AND e.space_id=? AND e.user_id=?" {
		t.Fatalf("personal filter = %q", personalWhere)
	}
	if len(personalArgs) != 3 || personalArgs[0] != spacePersonal || personalArgs[1] != int64(0) || personalArgs[2] != "u1" {
		t.Fatalf("personal args = %v", personalArgs)
	}
	denyWhere, denyArgs := auditSpaceFilter(spaceRef{Kind: spaceTeam, ID: 0}, "u1")
	if denyWhere != "1=0" || len(denyArgs) != 0 {
		t.Fatalf("deny filter = %q %v", denyWhere, denyArgs)
	}
	emptyActor, _ := auditSpaceFilter(spaceRef{Kind: spacePersonal, ID: 0}, " ")
	if emptyActor != "1=0" {
		t.Fatalf("empty actor filter = %q", emptyActor)
	}
}

func TestParseAuditQueryRejectsUnknownAction(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/admin/audit?action=<script>", nil)
	q := parseAuditQuery(&request{r: r})
	if q.Action != "" {
		t.Fatalf("unknown action accepted: %q", q.Action)
	}
	if q.PageSize != auditDefaultPageSize {
		t.Fatalf("default page_size = %d", q.PageSize)
	}
}

func TestAuditActionCatalogCoversEveryEvent(t *testing.T) {
	expected := []string{
		"login", "change_password", "enable_space",
		"create_customer", "upload_queued",
		"confirm_ownership", "confirm_period", "update_rules",
		"review_transactions", "submit_review",
		"report_queued", "download_report", "job_cancelled",
		"add_user", "toggle_user", "remove_user", "change_grant",
	}
	for _, action := range expected {
		meta, ok := auditActionCatalog[action]
		if !ok || meta.Label == "" || meta.Category == "" {
			t.Fatalf("missing audit metadata for %q", action)
		}
		if !auditShouldPersist(action) {
			t.Fatalf("keep action %q must persist", action)
		}
	}
	if len(auditActionOptions()) != len(expected) {
		t.Fatalf("action options = %d", len(auditActionOptions()))
	}
	for _, noise := range []string{
		"switch_space", "view_original", "view_original_page",
		"upload_finished", "report_finished", "ai_analysis_finished", "job_timeout",
	} {
		if auditShouldPersist(noise) {
			t.Fatalf("noise action %q must not persist", noise)
		}
	}
}

func TestAuditDetailLabelIsHumanReadable(t *testing.T) {
	cases := []struct {
		action, detail, want string
	}{
		{"login", "team:2", "团队空间"},
		{"login", "personal:0", "个人空间"},
		{"enable_space", "platform:1", "平台空间"},
		{"download_report", "8ee5bad9c207c3cfaeaac8e5d32169b7/report.html", "网页报告"},
		{"download_report", "abc/report.pdf", "PDF 报告"},
		{"download_report", "abc/summary.xlsx", "汇总表"},
		{"download_report", "abc/detail.xlsx", "明细表"},
		{"upload_queued", "3", "上传 3 份资料"},
		{"review_transactions", "12", "核对 12 笔"},
		{"change_password", "workbench", "工作台账号"},
		{"change_grant", "wb:99", "已调整授权"},
		{"add_user", "ops@example.com", "ops@example.com"},
		{"create_customer", "", ""},
	}
	for _, tc := range cases {
		if got := auditDetailLabel(tc.action, tc.detail); got != tc.want {
			t.Fatalf("%s/%q = %q, want %q", tc.action, tc.detail, got, tc.want)
		}
	}
}

func TestAuditTimeBoundsAreNormalized(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/admin/audit?from=2026-01-01&to=2026-02-01T12:00:00%2B08:00", nil)
	q := parseAuditQuery(&request{r: r})
	if q.From != "2026-01-01 00:00:00" {
		t.Fatalf("from = %q", q.From)
	}
	if q.To != "2026-02-01 04:00:00" {
		t.Fatalf("to = %q", q.To)
	}
	bad := httptest.NewRequest("GET", "/api/admin/audit?from=not-a-date", nil)
	if got := parseAuditQuery(&request{r: bad}).From; got != "" {
		t.Fatalf("malformed date accepted: %q", got)
	}
}
