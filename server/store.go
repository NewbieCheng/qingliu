package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	mysql "github.com/go-sql-driver/mysql"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed schema.sql
var schema string

type Store struct {
	db    *sql.DB
	root  string
	vault cipher.AEAD
}

func openStore() (*Store, error) {
	cfg, e := mysql.ParseDSN(os.Getenv("MYSQL_DSN"))
	if e != nil || cfg.DBName == "" {
		return nil, errors.New("MYSQL_DSN 必须指定专用数据库")
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	if cfg.Params == nil {
		cfg.Params = map[string]string{}
	}
	cfg.Params["time_zone"] = "'+00:00'"
	cfg.Timeout = 10 * time.Second
	cfg.ReadTimeout = 30 * time.Second
	cfg.WriteTimeout = 30 * time.Second
	cfg.MultiStatements = false
	db, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(3)
	db.SetConnMaxLifetime(3 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if e = db.PingContext(ctx); e != nil {
		db.Close()
		return nil, e
	}
	for _, s := range strings.Split(schema, ";") {
		if strings.TrimSpace(s) != "" {
			if _, e = db.ExecContext(ctx, s); e != nil {
				db.Close()
				return nil, e
			}
		}
	}
	root := os.Getenv("DATA_DIR")
	if root == "" {
		root = "data"
	}
	root, e = filepath.Abs(root)
	if e != nil {
		return nil, e
	}
	if e = os.MkdirAll(root, 0700); e != nil {
		return nil, e
	}
	raw, e := hex.DecodeString(os.Getenv("VAULT_KEY"))
	if e != nil || len(raw) != 32 {
		return nil, errors.New("VAULT_KEY 必须为64位十六进制随机密钥")
	}
	block, _ := aes.NewCipher(raw)
	aead, _ := cipher.NewGCM(block)
	return &Store{db, root, aead}, nil
}
func (s *Store) exec(q string, args ...any) {
	if _, e := s.db.Exec(q, args...); e != nil {
		panic(e)
	}
}
func (s *Store) query(q string, args ...any) []Object {
	rows, e := s.db.Query(q, args...)
	if e != nil {
		panic(e)
	}
	defer rows.Close()
	cols, e := rows.Columns()
	if e != nil {
		panic(e)
	}
	out := []Object{}
	for rows.Next() {
		v := make([]any, len(cols))
		p := make([]any, len(cols))
		for i := range v {
			p[i] = &v[i]
		}
		if e = rows.Scan(p...); e != nil {
			panic(e)
		}
		o := Object{}
		for i, k := range cols {
			switch t := v[i].(type) {
			case []byte:
				o[k] = string(t)
			case time.Time:
				o[k] = t.UTC().Format(time.RFC3339Nano)
			default:
				o[k] = t
			}
		}
		out = append(out, o)
	}
	if e = rows.Err(); e != nil {
		panic(e)
	}
	return out
}
func (s *Store) one(q string, args ...any) Object {
	rows := s.query(q, args...)
	if len(rows) == 0 {
		return nil
	}
	return rows[0]
}
func (s *Store) lock(ctx context.Context, name string) (func(), error) {
	c, e := s.db.Conn(ctx)
	if e != nil {
		return nil, e
	}
	var got int
	if e = c.QueryRowContext(ctx, "SELECT GET_LOCK(?, 5)", "qingliu:"+hash([]byte(name))[:48]).Scan(&got); e != nil || got != 1 {
		c.Close()
		return nil, errors.New("当前操作繁忙，请稍后重试")
	}
	return func() {
		_, _ = c.ExecContext(context.Background(), "SELECT RELEASE_LOCK(?)", "qingliu:"+hash([]byte(name))[:48])
		c.Close()
	}, nil
}
func (s *Store) write(path string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	nonce := make([]byte, s.vault.NonceSize())
	if _, e := rand.Read(nonce); e != nil {
		return e
	}
	content := append([]byte("QLGO1\n"), nonce...)
	content = s.vault.Seal(content, nonce, b, nil)
	tmp := path + "." + id() + ".tmp"
	if e := os.WriteFile(tmp, content, 0600); e != nil {
		return e
	}
	if e := os.Rename(tmp, path); e != nil {
		os.Remove(tmp)
		return e
	}
	return nil
}
func (s *Store) read(path string) ([]byte, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return nil, e
	}
	if len(b) < 6+s.vault.NonceSize() || string(b[:6]) != "QLGO1\n" {
		return nil, errors.New("文件格式或密钥不匹配")
	}
	return s.vault.Open(nil, b[6:6+s.vault.NonceSize()], b[6+s.vault.NonceSize():], nil)
}
func (s *Store) event(user, cid, action, detail string) {
	var c any
	if cid != "" {
		c = cid
	}
	if len(detail) > 500 {
		detail = detail[:500]
	}
	s.exec("INSERT INTO ql_events(user_id,customer_id,action,detail) VALUES(?,?,?,?)", user, c, action, detail)
}
func (s *Store) allowed(user Object, cid string) bool {
	if s.one("SELECT id FROM ql_customers WHERE id=?", cid) == nil {
		return false
	}
	return str(user, "role") == "admin" || s.one("SELECT customer_id FROM ql_grants WHERE customer_id=? AND user_id=?", cid, user["id"]) != nil
}

// jobProgress records the human-facing stage and percentage of a running
// background job. Progress is display-only: it never drives billing, access or
// report state, and it is re-derived from DB status after a restart.
func (s *Store) jobProgress(jid, stage, message string, progress int) {
	if progress < 0 {
		progress = 0
	}
	if progress > 99 {
		progress = 99
	}
	s.exec("UPDATE ql_jobs SET stage=?,message=?,progress=? WHERE id=?", stage, message, progress, jid)
}

// parsePercent maps a page counter to the 5..95 band reserved for the local
// parse step. The remaining 5 percent is the write/commit phase.
func parsePercent(page, total int) int {
	if total <= 0 {
		return 10
	}
	if page < 1 {
		page = 1
	}
	if page > total {
		page = total
	}
	return 5 + (page*90)/total
}

func (s *Store) busy(cid string) bool {
	return s.one("SELECT id FROM ql_jobs WHERE customer_id=? AND status IN ('queued','running') LIMIT 1", cid) != nil
}
func (s *Store) bump(cid string) {
	s.exec("UPDATE ql_customers SET revision=revision+1 WHERE id=?", cid)
	s.exec("DELETE FROM ql_submissions WHERE customer_id=?", cid)
}
func (s *Store) rows(cid string) []Object {
	stored := s.query("SELECT payload FROM ql_transactions WHERE customer_id=? ORDER BY seq", cid)
	reviews := s.query("SELECT r.* FROM ql_reviews r JOIN ql_transactions t ON r.transaction_id=t.id WHERE t.customer_id=? ORDER BY r.seq", cid)
	latest := map[string]Object{}
	for _, r := range reviews {
		latest[str(r, "transaction_id")] = r
	}
	rows := []Object{}
	for _, r := range stored {
		t := obj(str(r, "payload"))
		if a := latest[str(t, "id")]; a != nil && str(a, "label") != "unreviewed" {
			t["review_label"] = a["label"]
			t["review_operator"] = a["operator"]
			t["review_reason"] = a["reason"]
		}
		rows = append(rows, t)
	}
	fields := obj(str(s.one("SELECT payload FROM ql_customers WHERE id=?", cid), "payload"))
	rules := nested(fields, "rules")
	if len(rules) == 0 {
		rules = defaultRules()
	}
	return evaluate(rows, rules, fields)
}
func (s *Store) documents(cid string) []Object {
	docs := s.query("SELECT id,name,sha,payload,created FROM ql_documents WHERE customer_id=? ORDER BY created,id", cid)
	for _, d := range docs {
		d["meta"] = obj(str(d, "payload"))
		delete(d, "payload")
	}
	return docs
}
func (s *Store) caseData(cid, source, start, end string) Object {
	c := s.one("SELECT * FROM ql_customers WHERE id=?", cid)
	fields := obj(str(c, "payload"))
	delete(c, "payload")
	docs, rows := s.documents(cid), s.rows(cid)
	choices := []string{}
	found := map[string]bool{}
	for _, t := range rows {
		v := str(t, "source")
		if !found[v] {
			choices = append(choices, v)
			found[v] = true
		}
	}
	saved := nested(fields, "web_period")
	if source == "" {
		source = str(saved, "source")
	}
	if source == "" && len(choices) > 0 {
		source = choices[0]
	}
	low, high := "", ""
	for _, t := range rows {
		d := str(t, "date")
		if str(t, "source") == source && d != "" {
			if low == "" || d < low {
				low = d
			}
			if d > high {
				high = d
			}
		}
	}
	for _, d := range docs {
		m := nested(d, "meta")
		if str(m, "source") == source {
			parts := strings.Split(str(m, "coverage"), " / ")
			if len(parts) == 2 {
				if _, e := iso(parts[0]); e == nil {
					if low == "" || parts[0] < low {
						low = parts[0]
					}
				}
				if _, e := iso(parts[1]); e == nil && parts[1] > high {
					high = parts[1]
				}
			}
		}
	}
	if low == "" {
		low = time.Now().UTC().Format("2006-01-02")
		high = low
	}
	if start == "" {
		if str(saved, "source") == source {
			start = str(saved, "start")
		}
		if start == "" {
			start = low
		}
	}
	if end == "" {
		if str(saved, "source") == source {
			end = str(saved, "end")
		}
		if end == "" {
			end = high
		}
	}
	if v, e := iso(start); e != nil || v != start {
		bad(400, "开始日期无效")
	}
	if v, e := iso(end); e != nil || v != end {
		bad(400, "截止日期无效")
	}
	if start > end {
		bad(400, "开始日期不能晚于截止日期")
	}
	a, _ := time.Parse("2006-01-02", start)
	b, _ := time.Parse("2006-01-02", end)
	if b.Sub(a) > 366*20*24*time.Hour {
		bad(400, "统计范围最多20年")
	}
	result := summary(rows, source, start, end)
	problems := []string{}
	if len(docs) == 0 {
		problems = append(problems, "尚未上传资料")
	}
	scopes := nested(fields, "document_scopes")
	for _, d := range docs {
		sc, _ := scopes[str(d, "id")].(map[string]any)
		if !yes(sc, "confirmed") {
			problems = append(problems, "资料归属尚未确认："+str(d, "name"))
		}
		if (!yes(sc, "confirmed") || yes(sc, "include")) && str(nested(d, "meta"), "status") != "success" {
			problems = append(problems, "资料识别尚未完整通过："+str(d, "name"))
		}
	}
	if integer(result["pending_count"]) > 0 {
		problems = append(problems, "仍有交易疑点未处理")
	}
	usable := false
	for _, t := range rows {
		if str(t, "source") == source && str(t, "date") >= start && str(t, "date") <= end && !yes(t, "scope_excluded") && str(t, "quality") != "invalid" {
			usable = true
		}
	}
	if !usable {
		problems = append(problems, "当前范围无可用交易")
	}
	if !yes(fields, "coverage_confirmed") || str(saved, "source") != source || str(saved, "start") != start || str(saved, "end") != end {
		problems = append(problems, "统计期间与资料完整性尚未确认")
	}
	reports := s.query("SELECT id,payload,created FROM ql_reports WHERE customer_id=? ORDER BY seq DESC", cid)
	for _, r := range reports {
		r["info"] = obj(str(r, "payload"))
		delete(r, "payload")
	}
	sub := s.one("SELECT revision,payload FROM ql_submissions WHERE customer_id=?", cid)
	submitted := sub != nil && integer(sub["revision"]) == integer(c["revision"]) && str(obj(str(sub, "payload")), "source") == source && str(obj(str(sub, "payload")), "start") == start && str(obj(str(sub, "payload")), "end") == end
	return Object{"customer": c, "fields": fields, "docs": docs, "rows": rows, "source": source, "start": start, "end": end, "choices": choices, "summary": result, "problems": problems, "reports": reports, "submitted_current": submitted, "busy": s.busy(cid), "jobs": s.query("SELECT id,kind,status,message,created FROM ql_jobs WHERE customer_id=? ORDER BY seq DESC LIMIT 30", cid)}
}
func must(e error) {
	if e != nil {
		panic(e)
	}
}
func (s *Store) insertParse(cid, did, name, sha string, result ParseResult) error {
	tx, e := s.db.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if _, e = tx.Exec("INSERT INTO ql_documents(id,customer_id,sha,name,payload) VALUES(?,?,?,?,?)", did, cid, sha, name, js(result.Meta)); e != nil {
		return e
	}
	for _, t := range result.Rows {
		var key any
		if str(t, "transaction_id") != "" {
			key = []any{t["source"], t["account"], t["transaction_id"]}
		} else {
			key = []any{t["source"], t["account"], t["date"], t["time"], t["income"], t["expense"], t["counterparty"], t["memo"]}
		}
		fp := hash([]byte(js(key)))
		var n int
		if e = tx.QueryRow("SELECT COUNT(*) FROM ql_transactions WHERE customer_id=? AND fingerprint=?", cid, fp).Scan(&n); e != nil {
			return e
		}
		t["id"] = id()
		t["document_id"] = did
		t["filename"] = name
		t["duplicate"] = n > 0
		if _, e = tx.Exec("INSERT INTO ql_transactions(id,customer_id,document_id,fingerprint,payload) VALUES(?,?,?,?,?)", t["id"], cid, did, fp, js(t)); e != nil {
			return e
		}
	}
	return tx.Commit()
}
func validateRules(c Object) error {
	for _, k := range []string{"positive", "negative"} {
		if len(list(c[k])) == 0 {
			return fmt.Errorf("%s 不能为空", k)
		}
		for _, w := range list(c[k]) {
			if strings.TrimSpace(text(w)) == "" {
				return errors.New("关键词不能为空")
			}
		}
	}
	for _, k := range []string{"cash_mode", "loan_mode", "platform_mode"} {
		if v := str(c, k); v != "included" && v != "excluded" && v != "pending" {
			return errors.New("规则模式无效")
		}
	}
	if integer(c["large_cents"]) <= 0 || integer(c["frequent_count"]) <= 0 {
		return errors.New("金额与频次阈值须大于0")
	}
	if len(list(c["related"])) > 50 {
		return errors.New("关联名单最多50项")
	}
	for _, v := range list(c["related"]) {
		r, ok := v.(map[string]any)
		if !ok || (str(r, "name") == "" && str(r, "account") == "") || (str(r, "mode") != "pending" && str(r, "mode") != "excluded") {
			return errors.New("关联名单格式无效")
		}
	}
	return nil
}
