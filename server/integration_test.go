package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func integrationStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("MYSQL_DSN")
	if dsn == "" {
		t.Skip("MYSQL_DSN not set; integration requires dedicated *_test database")
	}
	if !strings.Contains(strings.Split(dsn, "?")[0], "_test") {
		t.Fatal("integration database must end in _test")
	}
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("VAULT_KEY", strings.Repeat("a1", 32))
	s, e := openStore()
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.db.Close() })
	return s
}

type testClient struct {
	t         *testing.T
	client    *http.Client
	url, csrf string
}

func (c *testClient) req(method, path string, body any) (int, Object, []byte) {
	c.t.Helper()
	var reader io.Reader
	contentType := "application/json"
	if body != nil {
		reader = strings.NewReader(js(body))
	}
	r, e := http.NewRequest(method, c.url+path, reader)
	if e != nil {
		c.t.Fatal(e)
	}
	r.Header.Set("Content-Type", contentType)
	r.Header.Set("X-CSRF-Token", c.csrf)
	r.Header.Set("Origin", "http://test.local")
	response, e := c.client.Do(r)
	if e != nil {
		c.t.Fatal(e)
	}
	defer response.Body.Close()
	b, _ := io.ReadAll(response.Body)
	var o Object
	_ = json.Unmarshal(b, &o)
	return response.StatusCode, o, b
}
func (c *testClient) post(path string, body any) Object {
	c.t.Helper()
	code, o, _ := c.req("POST", path, body)
	if code != 200 {
		c.t.Fatalf("POST %s: %d %v", path, code, o)
	}
	return o
}
func TestMySQLWorkflow(t *testing.T) {
	s := integrationStore(t)
	adminName := "admin" + id()[:8]
	salesName := "sales" + id()[:8]
	otherName := "other" + id()[:8]
	reviewName := "review" + id()[:8]
	pass := "integration-only-password"
	for name, role := range map[string]string{adminName: "admin", salesName: "sales", otherName: "sales", reviewName: "reviewer"} {
		must(s.addUser(name, name, pass, role))
	}
	static := t.TempDir()
	os.WriteFile(filepath.Join(static, "index.html"), []byte("<html>test</html>"), 0600)
	a := &App{s: s, origin: "http://test.local", static: static, slots: make(chan struct{}, 4)}
	srv := httptest.NewServer(a.mux())
	defer srv.Close()
	login := func(name string) *testClient {
		jar, _ := cookiejar.New(nil)
		c := &testClient{t: t, client: &http.Client{Jar: jar}, url: srv.URL}
		c.post("/api/login", Object{"username": name, "password": pass})
		code, o, _ := c.req("GET", "/api/me", nil)
		if code != 200 {
			t.Fatal(o)
		}
		c.csrf = str(o, "csrf")
		return c
	}
	sales, other, admin, reviewer := login(salesName), login(otherName), login(adminName), login(reviewName)
	cid := str(sales.post("/api/clients", Object{"name": "合成验收客户", "authorized": true}), "id")
	base := "/api/clients/" + cid
	for _, path := range []string{base, base + "/jobs", base + "/transaction/fake", base + "/reports/fake/report.pdf", base + "/original/fake/1"} {
		if code, _, _ := other.req("GET", path, nil); code != 404 {
			t.Fatalf("unauthorized %s: %d", path, code)
		}
	}
	if code, _, _ := reviewer.req("GET", base, nil); code != 404 {
		t.Fatal("reviewer got implicit access")
	}
	uid := s.one("SELECT id FROM ql_users WHERE username=?", reviewName)["id"]
	admin.post(base+"/grant", Object{"user_id": uid})
	if code, _, _ := reviewer.req("GET", base, nil); code != 200 {
		t.Fatal("grant failed")
	}
	prev := sales.csrf
	sales.csrf = "bad"
	if code, _, _ := sales.req("POST", base+"/submit", Object{}); code != 403 {
		t.Fatal("csrf accepted")
	}
	sales.csrf = prev
	csv := []byte("date,direction,amount,counterparty,memo,transaction_id\n2026-01-01,收入,100.01,买家,货款,T1\n2026-01-02,收入,30.03,柜台,现金,T2\n2026-01-03,支出,5.05,商户,消费,T3\n2026-01-04,收入,1.23,银行,结息,T4\n")
	upload := func() {
		var b bytes.Buffer
		w := multipart.NewWriter(&b)
		f, _ := w.CreateFormFile("files", "synthetic.csv")
		f.Write(csv)
		w.WriteField("source", "bank_statement")
		w.Close()
		r, _ := http.NewRequest("POST", srv.URL+base+"/upload", &b)
		r.Header.Set("Content-Type", w.FormDataContentType())
		r.Header.Set("X-CSRF-Token", sales.csrf)
		res, e := sales.client.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			x, _ := io.ReadAll(res.Body)
			t.Fatalf("upload: %d %s", res.StatusCode, x)
		}
	}
	upload()
	if !s.busy(cid) {
		t.Fatal("not queued")
	}
	if code, _, _ := sales.req("POST", base+"/ownership", Object{}); code != 409 {
		t.Fatal("busy mutation allowed")
	}
	if !runOne(context.Background(), s) {
		t.Fatal("no task")
	}
	rows := s.rows(cid)
	if len(rows) != 4 || !yes(rows[0], "scope_excluded") {
		t.Fatalf("rows %v", rows)
	}
	docs := s.documents(cid)
	did := str(docs[0], "id")
	sales.post(base+"/ownership", Object{"scopes": Object{did: Object{"holder": "合成人员", "relationship": "本人", "include": true}}})
	var cash string
	for _, r := range s.rows(cid) {
		if str(r, "memo") == "现金" {
			cash = str(r, "id")
		}
	}
	rangeQuery := "?source=bank_statement&start=2026-01-01&end=2026-02-28"
	sales.post(base+"/review", Object{"ids": []string{cash}, "label": "included", "reason": "合成凭证已核对"})
	sales.post(base+"/coverage"+rangeQuery, Object{"confirmed": true})
	sales.post(base+"/submit"+rangeQuery, Object{})
	if code, _, _ := sales.req("POST", base+"/report"+rangeQuery, Object{"stage": "formal", "attest": true, "statement": "合成测试"}); code != 403 {
		t.Fatal("sales issued formal")
	}
	reviewer.post(base+"/report"+rangeQuery, Object{"stage": "formal", "attest": true, "statement": "已对照合成原件"})
	if !runOne(context.Background(), s) {
		t.Fatal("no report task")
	}
	job := s.one("SELECT * FROM ql_jobs WHERE customer_id=? AND kind='report' ORDER BY seq DESC LIMIT 1", cid)
	if str(job, "status") != "done" {
		t.Fatalf("report failed: %v", job)
	}
	report := s.one("SELECT * FROM ql_reports WHERE customer_id=?", cid)
	rid := str(report, "id")
	var pdf []byte
	for _, file := range []string{"report.pdf", "summary.xlsx", "detail.xlsx", "report.html"} {
		code, _, b := sales.req("GET", base+"/reports/"+rid+"/"+file, nil)
		if code != 200 || len(b) < 100 {
			t.Fatalf("download %s %d", file, code)
		}
		if file == "report.pdf" {
			pdf = b
			if !bytes.HasPrefix(b, []byte("%PDF-")) {
				t.Fatal("invalid PDF")
			}
		}
	}
	s.exec("UPDATE ql_jobs SET status='queued' WHERE id=?", job["id"])
	runOne(context.Background(), s)
	if integer(s.one("SELECT COUNT(*) n FROM ql_reports WHERE customer_id=?", cid)["n"]) != 1 {
		t.Fatal("duplicate report on recovery")
	}
	sales.post(base+"/review", Object{"ids": []string{cash}, "label": "pending", "reason": "撤回凭证待补充"})
	if s.one("SELECT * FROM ql_submissions WHERE customer_id=?", cid) != nil {
		t.Fatal("submission not invalidated")
	}
	_, _, after := sales.req("GET", base+"/reports/"+rid+"/report.pdf", nil)
	if !bytes.Equal(pdf, after) {
		t.Fatal("snapshot changed")
	}
	if code, _, _ := reviewer.req("POST", base+"/report"+rangeQuery, Object{"stage": "formal", "attest": true, "statement": "过期"}); code != 400 {
		t.Fatal("stale formal accepted")
	}
	res, e := sales.client.Get(srv.URL + base)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("sensitive caching")
	}
	sales.post("/api/password", Object{"current_password": pass, "new_password": "new-integration-password"})
	if code, _, _ := sales.req("GET", "/api/me", nil); code != 401 {
		t.Fatal("password rotation did not revoke")
	}
	uid = s.one("SELECT id FROM ql_users WHERE username=?", otherName)["id"]
	admin.post("/api/admin/users/"+text(uid)+"/toggle", Object{})
	if code, _, _ := other.req("GET", "/api/me", nil); code != 401 {
		t.Fatal("deactivation did not revoke")
	}
	// Audit log: service-side pagination, whitelist filtering and access control.
	if code, _, _ := sales.req("GET", "/api/admin/audit", nil); code != 403 {
		t.Fatal("non-admin read audit log")
	}
	code, page, _ := admin.req("GET", "/api/admin/audit?page=1&page_size=2", nil)
	if code != 200 || integer(page["count"]) < 1 || len(page["events"].([]any)) > 2 {
		t.Fatalf("audit page: %d %v", code, page)
	}
	if page["page_size"] != float64(2) {
		t.Fatalf("audit page_size = %v", page["page_size"])
	}
	code, filtered, _ := admin.req("GET", "/api/admin/audit?action=login&page_size=1000", nil)
	if code != 200 || filtered["page_size"] != float64(auditMaxPageSize) {
		t.Fatalf("audit filter/bound: %d %v", code, filtered)
	}
	for _, event := range filtered["events"].([]any) {
		if str(event.(Object), "action") != "login" || str(event.(Object), "action_label") != "登录" {
			t.Fatalf("audit filter leak: %v", event)
		}
	}
	_, overview, _ := admin.req("GET", "/api/admin", nil)
	if _, ok := overview["events"]; ok {
		t.Fatal("/api/admin still returns unbounded events")
	}
	if _, ok := overview["users"]; !ok {
		t.Fatal("/api/admin missing users")
	}
}
