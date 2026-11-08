package main

import (
	"net/http/httptest"
	"testing"
)

func TestParseAuditQueryBoundsAndFilters(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/admin/audit?page=-2&page_size=999&action=login&user_id=u1&q=%E5%90%88%E6%88%90&from=2026-01-01&to=2026-02-01", nil)
	q := parseAuditQuery(&request{r: r})
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
	if where == "1=1" || len(args) != 5 {
		t.Fatalf("filter = %q args=%v", where, args)
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
		"login", "change_password", "create_customer", "upload_queued",
		"upload_finished", "confirm_ownership", "confirm_period", "update_rules",
		"review_transactions", "view_original", "view_original_page",
		"submit_review", "report_queued", "report_finished", "download_report",
		"add_user", "toggle_user", "change_grant",
	}
	for _, action := range expected {
		meta, ok := auditActionCatalog[action]
		if !ok || meta.Label == "" || meta.Category == "" {
			t.Fatalf("missing audit metadata for %q", action)
		}
	}
	if len(auditActionOptions()) != len(expected) {
		t.Fatalf("action options = %d", len(auditActionOptions()))
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
