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
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	mysql "github.com/go-sql-driver/mysql"
)

//go:embed schema.sql
var schema string

// rowsCacheEntry 缓存「已评估」的交易行，避免翻页/筛选反复全表读 + evaluate。
// 键为客户 id；revision 变化（bump）即失效。
type rowsCacheEntry struct {
	revision int64
	rows     []Object
}

type Store struct {
	db        *sql.DB
	root      string
	vault     cipher.AEAD
	rowsMu    sync.Mutex
	rowsCache map[string]rowsCacheEntry
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
	return &Store{db: db, root: root, vault: aead}, nil
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
func (s *Store) event(space spaceRef, user, cid, action, detail string) {
	// 唯一写入闸门：不在白名单的动作（切空间、翻原件、任务完成码等）直接丢弃。
	if !auditShouldPersist(action) {
		return
	}
	var c any
	if cid != "" {
		c = cid
	}
	if len(detail) > 500 {
		detail = detail[:500]
	}
	space = spaceOf(Object{"space_kind": space.Kind, "space_id": space.ID})
	s.exec(
		"INSERT INTO ql_events(user_id,customer_id,action,detail,space_kind,space_id) VALUES(?,?,?,?,?,?)",
		user, c, action, detail, space.Kind, space.ID,
	)
}

// allowed reports whether the caller may touch this customer.
//
// 授权维度是**当前空间 + 工作台身份**，不是清流本地角色：
//   - 团队管理员：本企业全部资料；
//   - 团队非管理员：仅 ql_grants 绑了自己 workbench_user_id 的客户；
//   - 个人空间：自己创建的，或被显式授权的；
//   - 管理员不能跨企业 —— 之前 role=="admin" 无条件放行的漏洞已修掉。
//
// 空间由调用方给出：前台请求来自会话，后台任务来自任务行。
// 条件由 scopeWhere 生成，与列表查询共用同一份实现。
func (s *Store) allowed(access customerAccess, cid string) bool {
	where, args := scopeWhere(access, "c")
	args = append(args, cid)
	return s.one("SELECT c.id FROM ql_customers c WHERE "+where+" AND c.id=?", args...) != nil
}

// jobProgress records the human-facing stage and percentage of a running
// background job. Progress is display-only: it never drives billing, access or
// report state, and it is re-derived from DB status after a restart.
//
// 注意：这里**不改 status**。任务在 worker 取走时由 jobStart 置为 running，
// 结束时由调用方显式写 done/failed；两者都不经过本函数。曾经因为在写
// progress 时顺手不改 status，ql_jobs.status 里永远没有 running，
// 一旦某条分支漏写终态，任务就永久停在 queued 把整个客户锁死。
func (s *Store) jobProgress(jid, stage, message string, progress int) {
	if progress < 0 {
		progress = 0
	}
	if progress > 99 {
		progress = 99
	}
	s.exec("UPDATE ql_jobs SET stage=?,message=?,progress=? WHERE id=?", stage, message, progress, jid)
}

// jobStart 把任务标记为执行中。worker 取到任务后必须立刻调用它，
// 这样 busy() 与队列位置才能区分「正在跑」和「还在排队」。
func (s *Store) jobStart(jid string) {
	s.exec("UPDATE ql_jobs SET status='running',stage='starting',message='正在准备处理',progress=3 WHERE id=?", jid)
}

// jobFinish 写入终态。所有分支（含 AI 分析）都必须走到这里，
// 否则任务会停在中间态永远占着客户。
func (s *Store) jobFinish(jid, status, message string) {
	progress := 0
	switch status {
	case "done", "partial":
		progress = 100
	case "failed":
		progress = 0
	default:
		status = "failed"
	}
	s.exec("UPDATE ql_jobs SET status=?,message=?,stage=?,progress=? WHERE id=?", status, message, status, progress, jid)
}

// staleJobMinutes 是判定任务卡死的时限。AI 分析本身有 10 分钟超时，
// 这里留出余量；超过这个时间仍在 queued/running 的任务一律视为失效，
// 不再阻断该客户的写操作，并会被 sweepStaleJobs 标成失败。
const staleJobMinutes = 30

// queuePosition 返回该任务前面还有几个待处理任务（0 表示下一个就是它）。
//
// 单进程串行解析，用户最关心的是「还要等几份」，而不是一个笼统的「排队中」。
// 只统计排队中（queued）且 seq 更小的任务，与 worker 的取任务顺序一致；
// 正在执行的那条已经是 running，不算在「前面还有」里。
func (s *Store) queuePosition(jid string) int {
	row := s.one("SELECT seq FROM ql_jobs WHERE id=?", jid)
	if row == nil {
		return 0
	}
	ahead := s.one("SELECT COUNT(*) AS n FROM ql_jobs WHERE status='queued' AND seq<?", row["seq"])
	return int(integer(ahead["n"]))
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

// busy 判断该客户是否真有在跑的任务。超过 staleJobMinutes 仍停在
// queued/running 的记录视为卡死，不计入 busy，避免一条失败任务把
// 上传、核对、报告等所有写操作永久挡在门外。
// busy 只统计会改底稿/报告产物的任务（upload / report）。
// AI 辅助分析是旁路意见，跑着时仍应允许核对勾选与归属确认；
// 否则「开始分析」会把整页复选框和保存处理一起锁死，看起来像勾选坏了。
func (s *Store) busy(cid string) bool {
	return s.one("SELECT id FROM ql_jobs WHERE customer_id=? AND kind IN ('upload','report') AND status IN ('queued','running') AND created > DATE_SUB(NOW(6), INTERVAL ? MINUTE) LIMIT 1", cid, staleJobMinutes) != nil
}
func (s *Store) bump(cid string) {
	s.exec("UPDATE ql_customers SET revision=revision+1 WHERE id=?", cid)
	s.exec("DELETE FROM ql_submissions WHERE customer_id=?", cid)
	s.invalidateRows(cid)
}

func (s *Store) invalidateRows(cid string) {
	s.rowsMu.Lock()
	defer s.rowsMu.Unlock()
	if s.rowsCache != nil {
		delete(s.rowsCache, cid)
	}
}

func (s *Store) rows(cid string) []Object {
	rev := int64(0)
	if c := s.one("SELECT revision,payload FROM ql_customers WHERE id=?", cid); c != nil {
		rev = integer(c["revision"])
		s.rowsMu.Lock()
		if s.rowsCache != nil {
			if hit, ok := s.rowsCache[cid]; ok && hit.revision == rev {
				out := hit.rows
				s.rowsMu.Unlock()
				return out
			}
		}
		s.rowsMu.Unlock()
		fields := obj(str(c, "payload"))
		rules := nested(fields, "rules")
		if len(rules) == 0 {
			rules = defaultRules()
		}
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
		evaluated := evaluate(rows, rules, fields)
		s.rowsMu.Lock()
		if s.rowsCache == nil {
			s.rowsCache = map[string]rowsCacheEntry{}
		}
		s.rowsCache[cid] = rowsCacheEntry{revision: rev, rows: evaluated}
		s.rowsMu.Unlock()
		return evaluated
	}
	return []Object{}
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
