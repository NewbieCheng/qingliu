package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/crypto/bcrypt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type apiError struct {
	code    int
	message string
}

func bad(code int, message string) { panic(apiError{code, message}) }
func require(ok bool, message string) {
	if !ok {
		bad(400, message)
	}
}

type App struct {
	s      *Store
	secure bool
	origin string
	static string
	slots  chan struct{}
	wb     wbConfig
}
type request struct {
	w       http.ResponseWriter
	r       *http.Request
	user    Object
	session Object
	app     *App
}

func (q *request) json(v any) {
	q.w.Header().Set("Content-Type", "application/json; charset=utf-8")
	must(json.NewEncoder(q.w).Encode(browserJSON(v)))
}
func (q *request) body() Object {
	defer q.r.Body.Close()
	q.r.Body = http.MaxBytesReader(q.w, q.r.Body, 1<<20)
	var v Object
	d := json.NewDecoder(q.r.Body)
	d.UseNumber()
	if d.Decode(&v) != nil || v == nil {
		bad(400, "请求格式无效")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		bad(400, "请求格式无效")
	}
	return v
}
func (a *App) route(fn func(*request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if e := recover(); e != nil {
				code, message := 500, "处理失败，请联系管理员"
				switch v := e.(type) {
				case apiError:
					code, message = v.code, v.message
				default:
					log.Printf("request failed: %T", e)
				}
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(code)
				_ = json.NewEncoder(w).Encode(Object{"error": message})
			}
		}()
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'")
		if a.secure {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		select {
		case a.slots <- struct{}{}:
			defer func() { <-a.slots }()
		default:
			bad(503, "当前服务器繁忙，请稍后重试")
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
		q := &request{w: w, r: r, app: a}
		if c, e := r.Cookie("ql_session"); e == nil {
			q.session = a.s.one("SELECT s.token,s.csrf,u.id,u.username,u.display,u.role,w.workbench_user_id,w.service_role,w.email AS wb_email FROM ql_sessions s JOIN ql_users u ON u.id=s.user_id LEFT JOIN ql_workbench_accounts w ON w.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1", hash([]byte(c.Value)), time.Now().Unix())
			q.user = q.session
		}
		public := r.URL.Path == "/api/login" || r.URL.Path == "/health"
		if strings.HasPrefix(r.URL.Path, "/api/") && !public && q.user == nil {
			bad(401, "请先登录")
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			// Same-origin JSON login and session-bound CSRF for every authenticated write.
			if origin := r.Header.Get("Origin"); origin != "" && origin != a.origin {
				bad(403, "请求来源不允许")
			}
			if r.URL.Path == "/api/login" {
				if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
					bad(400, "登录请求格式无效")
				}
			} else {
				if q.session == nil || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(str(q.session, "csrf"))) != 1 {
					bad(403, "页面已过期，请刷新")
				}
			}
		}
		fn(q)
	}
}
func (q *request) admin() {
	if str(q.user, "role") != "admin" {
		bad(403, "仅管理员可操作")
	}
}
func (q *request) access() string {
	cid := q.r.PathValue("cid")
	if !q.app.s.allowed(q.user, cid) {
		bad(404, "客户不存在或没有访问权限")
	}
	return cid
}
func (q *request) edit(fn func(string)) {
	cid := q.access()
	unlock, e := q.app.s.lock(q.r.Context(), "case:"+cid)
	if e != nil {
		bad(409, e.Error())
	}
	defer unlock()
	if q.app.s.busy(cid) {
		bad(409, "当前客户有后台任务，请等待完成")
	}
	fn(cid)
}
func (q *request) data(cid string) Object {
	v := q.r.URL.Query()
	return q.app.s.caseData(cid, v.Get("source"), v.Get("start"), v.Get("end"))
}
func (a *App) mux() http.Handler {
	m := http.NewServeMux()
	s := a.s
	m.HandleFunc("GET /health", a.route(func(q *request) {
		ctx, cancel := context.WithTimeout(q.r.Context(), 2*time.Second)
		defer cancel()
		if s.db.PingContext(ctx) != nil {
			bad(503, "数据库不可用")
		}
		q.json(Object{"status": "ok"})
	}))
	m.HandleFunc("POST /api/login", a.route(func(q *request) {
		b := q.body()
		name, pass := strings.TrimSpace(str(b, "username")), str(b, "password")
		require(len(name) <= 60 && len(pass) <= 72, "账号或密码格式无效")
		ip := q.r.RemoteAddr
		key := hash([]byte(ipHost(ip) + "/" + name))
		unlock, e := s.lock(q.r.Context(), "login:"+key)
		if e != nil {
			bad(429, "请稍后重试")
		}
		defer unlock()
		s.exec("DELETE FROM ql_login_failures WHERE at<?", time.Now().Unix()-900)
		failure := s.one("SELECT COUNT(*) AS n FROM ql_login_failures WHERE failure_key=?", key)
		if integer(failure["n"]) >= 5 {
			bad(429, "尝试次数过多，请15分钟后重试")
		}
		// Workbench accounts are the primary identity. A local password remains
		// as a transition fallback for the accounts created before the move; it
		// is removed once every operator has a workbench account.
		if a.wb.Ready() {
			if session, err := a.wb.login(q.r.Context(), name, pass); err == nil {
				uid := a.wbUpsertLocalUser(session)
				a.wbSaveLogin(uid, session)
				s.exec("DELETE FROM ql_login_failures WHERE failure_key=?", key)
				a.newSession(q, uid)
				q.json(Object{"ok": true})
				return
			}
		}
		u := s.one("SELECT * FROM ql_users WHERE username=? AND active=1", name)
		// Dummy bcrypt work also runs for an unknown account.
		hashed := []byte("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy")
		if u != nil {
			hashed = []byte(str(u, "password"))
		}
		err := bcrypt.CompareHashAndPassword(hashed, []byte(pass))
		if err != nil || u == nil {
			s.exec("INSERT INTO ql_login_failures VALUES(?,?)", key, time.Now().Unix())
			bad(401, "账号或密码不正确")
		}
		s.exec("DELETE FROM ql_login_failures WHERE failure_key=?", key)
		a.newSession(q, str(u, "id"))
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("GET /api/me", a.route(func(q *request) {
		q.json(Object{
			"user": Object{
				"id": q.user["id"], "username": q.user["username"], "display": q.user["display"], "role": q.user["role"],
				"service_code": "qingliu", "service_role": q.user["service_role"],
				"workbench_user_id": q.user["workbench_user_id"], "email": q.user["wb_email"],
				"workbench_linked": integer(q.user["workbench_user_id"]) > 0,
			},
			"csrf": q.session["csrf"],
		})
	}))
	m.HandleFunc("GET /api/billing/skus", a.route(func(q *request) {
		if !a.wb.Ready() {
			bad(503, "尚未接入工作台")
		}
		status, data, err := a.wb.do(q.r.Context(), http.MethodGet, "/api/v1/payment/skus?service_code=qingliu", nil, "")
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "套餐加载失败"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("POST /api/billing/orders", a.route(func(q *request) {
		b := q.body()
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodPost, "/api/v1/payment/orders", Object{"sku_code": str(b, "sku_code"), "service_code": "qingliu"})
		if err != nil {
			bad(503, err.Error())
		}
		if status < 200 || status >= 300 {
			bad(status, wbMessage(data, "下单失败"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("GET /api/billing/orders", a.route(func(q *request) {
		path := "/api/v1/payment/orders"
		if raw := q.r.URL.RawQuery; raw != "" {
			path += "?" + raw
		}
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, path, nil)
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "订单加载失败"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("GET /api/billing/orders/{order_no}", a.route(func(q *request) {
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, "/api/v1/payment/orders/"+q.r.PathValue("order_no"), nil)
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "订单不存在"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("GET /api/billing/balance", a.route(func(q *request) {
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, "/api/v1/account/balance", nil)
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "余额加载失败"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("GET /api/billing/ledgers", a.route(func(q *request) {
		path := "/api/v1/account/ledgers"
		if raw := q.r.URL.RawQuery; raw != "" {
			path += "?" + raw
		}
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, path, nil)
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "流水加载失败"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("POST /api/logout", a.route(func(q *request) {
		s.exec("DELETE FROM ql_sessions WHERE token=?", q.session["token"])
		http.SetCookie(q.w, &http.Cookie{Name: "ql_session", Value: "", Path: "/", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("POST /api/password", a.route(func(q *request) {
		b := q.body()
		p := str(b, "new_password")
		require(len(p) >= 10 && len(p) <= 72, "密码须为10至72字节")
		if integer(q.user["workbench_user_id"]) > 0 {
			status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodPost, "/api/v1/auth/password", Object{
				"current_password": str(b, "current_password"), "new_password": p,
			})
			if err != nil || status != http.StatusOK {
				bad(400, wbMessage(data, "当前密码不正确"))
			}
			s.event(str(q.user, "id"), "", "change_password", "workbench")
			q.json(Object{"ok": true})
			return
		}
		u := s.one("SELECT password FROM ql_users WHERE id=?", q.user["id"])
		require(bcrypt.CompareHashAndPassword([]byte(str(u, "password")), []byte(str(b, "current_password"))) == nil, "当前密码不正确")
		h, e := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
		must(e)
		s.exec("UPDATE ql_users SET password=? WHERE id=?", string(h), q.user["id"])
		s.exec("DELETE FROM ql_sessions WHERE user_id=?", q.user["id"])
		s.event(str(q.user, "id"), "", "change_password", "")
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("GET /api/clients", a.route(func(q *request) {
		search := q.r.URL.Query().Get("q")
		require(len(search) <= 120, "检索文字过长")
		page, _ := strconv.Atoi(q.r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		where := "(?='admin' OR EXISTS(SELECT 1 FROM ql_grants g WHERE g.customer_id=c.id AND g.user_id=?)) AND c.name LIKE ?"
		args := []any{q.user["role"], q.user["id"], "%" + search + "%"}
		count := s.one("SELECT COUNT(*) AS n FROM ql_customers c WHERE "+where, args...)
		args = append(args, 20, (page-1)*20)
		clients := s.query("SELECT c.id,c.name,c.created,(SELECT COUNT(*) FROM ql_documents d WHERE d.customer_id=c.id) AS doc_count,(SELECT COUNT(*) FROM ql_jobs j WHERE j.customer_id=c.id AND j.status IN ('queued','running')) AS running FROM ql_customers c WHERE "+where+" ORDER BY c.created DESC LIMIT ? OFFSET ?", args...)
		q.json(Object{"clients": clients, "count": count["n"], "page": page})
	}))
	m.HandleFunc("POST /api/clients", a.route(func(q *request) {
		b := q.body()
		name := strings.TrimSpace(str(b, "name"))
		require(name != "" && len([]rune(name)) <= 120 && yes(b, "authorized"), "请填写客户代号并确认资料处理授权")
		cid := id()
		tx, e := s.db.Begin()
		must(e)
		defer tx.Rollback()
		_, e = tx.Exec("INSERT INTO ql_customers(id,name,payload) VALUES(?,?,?)", cid, name, js(Object{"authorized": true, "company": str(b, "company"), "operator": q.user["display"], "rules": defaultRules(), "scope_required": true}))
		must(e)
		_, e = tx.Exec("INSERT INTO ql_grants VALUES(?,?)", cid, q.user["id"])
		must(e)
		must(tx.Commit())
		s.event(str(q.user, "id"), cid, "create_customer", "")
		q.json(Object{"id": cid})
	}))
	m.HandleFunc("GET /api/clients/{cid}", a.route(func(q *request) {
		cid := q.access()
		data := q.data(cid)
		rows := data["rows"].([]Object)
		view, search := q.r.URL.Query().Get("view"), q.r.URL.Query().Get("q")
		filtered := []Object{}
		for _, t := range rows {
			if str(t, "source") != str(data, "source") || str(t, "date") < str(data, "start") || str(t, "date") > str(data, "end") {
				continue
			}
			if view == "issues" && !needsReview(t) {
				continue
			}
			if view == "duplicate" && !yes(t, "duplicate") {
				continue
			}
			if view == "confirmed" && str(t, "review_label") == "" {
				continue
			}
			if search != "" && !strings.Contains(str(t, "counterparty")+str(t, "memo")+str(t, "date"), search) {
				continue
			}
			filtered = append(filtered, t)
		}
		page, _ := strconv.Atoi(q.r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		start := (page - 1) * 50
		if start > len(filtered) {
			start = len(filtered)
		}
		end := start + 50
		if end > len(filtered) {
			end = len(filtered)
		}
		data["rows"] = filtered[start:end]
		data["row_count"] = len(filtered)
		data["page"] = page
		q.json(data)
	}))
	m.HandleFunc("GET /api/clients/{cid}/jobs", a.route(func(q *request) {
		cid := q.access()
		q.json(Object{"jobs": s.query("SELECT id,kind,status,message,created FROM ql_jobs WHERE customer_id=? ORDER BY seq DESC LIMIT 30", cid)})
	}))
	m.HandleFunc("POST /api/clients/{cid}/upload", a.route(func(q *request) {
		q.edit(func(cid string) {
			if e := q.r.ParseMultipartForm(2 << 20); e != nil {
				bad(400, "上传失败；整批不能超过64MB")
			}
			defer q.r.MultipartForm.RemoveAll()
			files := q.r.MultipartForm.File["files"]
			require(len(files) >= 1 && len(files) <= 10, "每批请选择1至10份文件")
			source := q.r.FormValue("source")
			require(validSource(source), "无效来源")
			payloads := []Object{}
			paths := []string{}
			committed := false
			defer func() {
				if !committed {
					for _, p := range paths {
						os.Remove(p)
					}
				}
			}()
			seen := map[string]bool{}
			for _, f := range files {
				require(f.Size > 0 && f.Size <= 30<<20, "每份文件须为1字节至30MB")
				name := filepath.Base(strings.ReplaceAll(f.Filename, "\\", "/"))
				ext := strings.ToLower(filepath.Ext(name))
				require((ext == ".pdf" || ext == ".csv" || ext == ".xlsx") && len([]rune(name)) <= 240, "仅支持PDF、CSV、XLSX文件")
				stream, e := f.Open()
				must(e)
				b, e := io.ReadAll(io.LimitReader(stream, (30<<20)+1))
				stream.Close()
				must(e)
				require(len(b) <= 30<<20, "文件超过30MB")
				if ext == ".pdf" {
					require(bytesPrefixPDF(b), "文件内容不是PDF")
				}
				sha := hash(b)
				require(!seen[sha] && s.one("SELECT id FROM ql_documents WHERE customer_id=? AND sha=?", cid, sha) == nil, "重复文件：客户或本批次已上传此内容")
				seen[sha] = true
				jid := id()
				path := filepath.Join(s.root, "pending", jid)
				must(s.write(path, b))
				paths = append(paths, path)
				payloads = append(payloads, Object{"id": jid, "name": name, "sha": sha, "source": source, "ocr": q.r.FormValue("ocr") == "true"})
			}
			tx, e := s.db.Begin()
			must(e)
			defer tx.Rollback()
			for _, p := range payloads {
				_, e = tx.Exec("INSERT INTO ql_jobs(id,customer_id,user_id,kind,status,payload,message) VALUES(?,?,?,'upload','queued',?,'排队等待处理')", p["id"], cid, q.user["id"], js(p))
				must(e)
			}
			must(tx.Commit())
			committed = true
			s.bump(cid)
			s.event(str(q.user, "id"), cid, "upload_queued", fmt.Sprint(len(payloads)))
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("POST /api/clients/{cid}/ownership", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			scopes := nested(b, "scopes")
			docs := s.documents(cid)
			require(len(docs) > 0, "请先上传资料")
			for _, d := range docs {
				sc := nested(scopes, str(d, "id"))
				rel := str(sc, "relationship")
				require(strings.TrimSpace(str(sc, "holder")) != "" && (rel == "本人" || rel == "配偶" || rel == "子女" || rel == "其他"), "每份资料须填写持有人及关系")
				sc["confirmed"] = true
				sc["operator"] = q.user["display"]
				sc["at"] = time.Now().UTC().Format(time.RFC3339)
			}
			fields := obj(str(s.one("SELECT payload FROM ql_customers WHERE id=?", cid), "payload"))
			fields["document_scopes"] = scopes
			fields["relationship_note"] = str(b, "note")
			fields["spouse_name"] = str(b, "spouse_name")
			fields["child_name"] = str(b, "child_name")
			fields["coverage_confirmed"] = false
			s.exec("UPDATE ql_customers SET payload=? WHERE id=?", js(fields), cid)
			s.bump(cid)
			s.event(str(q.user, "id"), cid, "confirm_ownership", "")
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("POST /api/clients/{cid}/coverage", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			require(yes(b, "confirmed"), "请先核对原件期间与资料完整性")
			data := q.data(cid)
			fields := data["fields"].(Object)
			fields["coverage_confirmed"] = true
			fields["coverage_note"] = str(b, "note")
			fields["web_period"] = Object{"source": data["source"], "start": data["start"], "end": data["end"]}
			s.exec("UPDATE ql_customers SET payload=? WHERE id=?", js(fields), cid)
			s.bump(cid)
			s.event(str(q.user, "id"), cid, "confirm_period", js(fields["web_period"]))
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("POST /api/clients/{cid}/rules", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			if e := validateRules(b); e != nil {
				bad(400, e.Error())
			}
			fields := obj(str(s.one("SELECT payload FROM ql_customers WHERE id=?", cid), "payload"))
			fields["rules"] = b
			s.exec("UPDATE ql_customers SET payload=? WHERE id=?", js(fields), cid)
			s.bump(cid)
			s.event(str(q.user, "id"), cid, "update_rules", "")
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("POST /api/clients/{cid}/review", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			ids := list(b["ids"])
			require(len(ids) > 0 && len(ids) <= 50 && strings.TrimSpace(str(b, "reason")) != "", "请选择1至50笔交易并填写依据")
			current := map[string]Object{}
			for _, t := range s.rows(cid) {
				current[str(t, "id")] = t
			}
			changes := map[string]string{}
			for _, v := range ids {
				tid := text(v)
				t := current[tid]
				require(t != nil && !yes(t, "scope_excluded") && str(t, "quality") != "invalid", "记录不在可复核范围；错误金额须更正文件")
				label := str(b, "label")
				if label == "undo" {
					audits := s.query("SELECT label FROM ql_reviews WHERE transaction_id=? ORDER BY seq DESC LIMIT 2", tid)
					require(len(audits) > 0, "没有可撤销的确认")
					label = "unreviewed"
					if len(audits) > 1 {
						label = str(audits[1], "label")
					}
				}
				valid := label == "unreviewed" && str(b, "label") == "undo"
				if str(t, "direction") == "income" {
					valid = valid || label == "included" || label == "excluded" || label == "pending" || label == "duplicate"
				} else if yes(t, "duplicate") {
					valid = valid || label == str(t, "direction") || label == "duplicate"
				}
				require(valid, "分类不能改写原始收支方向")
				changes[tid] = label
			}
			tx, e := s.db.Begin()
			must(e)
			defer tx.Rollback()
			for tid, label := range changes {
				_, e = tx.Exec("INSERT INTO ql_reviews(transaction_id,label,operator,reason) VALUES(?,?,?,?)", tid, label, q.user["display"], str(b, "reason"))
				must(e)
			}
			must(tx.Commit())
			s.bump(cid)
			s.event(str(q.user, "id"), cid, "review_transactions", fmt.Sprint(len(changes)))
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("GET /api/clients/{cid}/transaction/{tid}", a.route(func(q *request) {
		cid := q.access()
		for _, t := range s.rows(cid) {
			if str(t, "id") == q.r.PathValue("tid") {
				s.event(str(q.user, "id"), cid, "view_original", str(t, "id"))
				q.json(Object{"row": t, "audits": s.query("SELECT label,operator,reason,created FROM ql_reviews WHERE transaction_id=? ORDER BY seq", t["id"])})
				return
			}
		}
		bad(404, "交易不存在")
	}))
	m.HandleFunc("GET /api/clients/{cid}/original/{did}/{page}", a.route(func(q *request) {
		cid := q.access()
		d := s.one("SELECT name,payload FROM ql_documents WHERE customer_id=? AND id=?", cid, q.r.PathValue("did"))
		if d == nil || strings.ToLower(filepath.Ext(str(d, "name"))) != ".pdf" {
			bad(404, "原PDF不存在")
		}
		page, e := strconv.Atoi(q.r.PathValue("page"))
		if e != nil || page < 1 || page > int(integer(obj(str(d, "payload"))["pages"])) {
			bad(404, "页码无效")
		}
		b, e := s.read(filepath.Join(s.root, "uploads", cid, q.r.PathValue("did")))
		must(e)
		ctx, cancel := context.WithTimeout(q.r.Context(), 30*time.Second)
		defer cancel()
		png, e := pdfPage(ctx, b, page)
		must(e)
		s.event(str(q.user, "id"), cid, "view_original_page", q.r.PathValue("did")+":"+fmt.Sprint(page))
		q.w.Header().Set("Content-Type", "image/png")
		_, e = q.w.Write(png)
		must(e)
	}))
	m.HandleFunc("POST /api/clients/{cid}/submit", a.route(func(q *request) {
		q.edit(func(cid string) {
			d := q.data(cid)
			require(len(d["problems"].([]string)) == 0, strings.Join(d["problems"].([]string), "；"))
			c := d["customer"].(Object)
			s.exec("INSERT INTO ql_submissions VALUES(?,?,?) ON DUPLICATE KEY UPDATE revision=VALUES(revision),payload=VALUES(payload)", cid, c["revision"], js(Object{"source": d["source"], "start": d["start"], "end": d["end"], "operator": q.user["display"]}))
			s.event(str(q.user, "id"), cid, "submit_review", "")
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("POST /api/clients/{cid}/report", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			d := q.data(cid)
			stage := str(b, "stage")
			require(stage == "draft" || stage == "formal", "报告状态无效")
			require(str(d, "source") != "", "没有可生成报告的流水来源")
			if stage == "formal" {
				if str(q.user, "role") != "admin" && str(q.user, "role") != "reviewer" {
					bad(403, "仅复核员或管理员可签发")
				}
				require(len(d["problems"].([]string)) == 0 && yes(d, "submitted_current") && yes(b, "attest") && strings.TrimSpace(str(b, "statement")) != "", "请完成资料核对与提交复核，并填写复核声明")
			}
			jid := id()
			payload := Object{"stage": stage, "revision": nested(d, "customer")["revision"], "source": d["source"], "start": d["start"], "end": d["end"], "statement": str(b, "statement"), "operator": q.user["display"]}
			s.exec("INSERT INTO ql_jobs(id,customer_id,user_id,kind,status,payload,message) VALUES(?,?,?,'report','queued',?,'等待生成报告')", jid, cid, q.user["id"], js(payload))
			s.event(str(q.user, "id"), cid, "report_queued", jid)
			q.json(Object{"id": jid})
		})
	}))
	m.HandleFunc("GET /api/clients/{cid}/ai-analysis", a.route(func(q *request) {
		cid := q.access()
		q.json(Object{"items": a.latestAIAnalyses(cid, 10)})
	}))
	m.HandleFunc("POST /api/clients/{cid}/ai-analysis", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			docID := str(b, "document_id")
			if docID == "" {
				latest := s.one("SELECT id FROM ql_documents WHERE customer_id=? ORDER BY created DESC,id DESC LIMIT 1", cid)
				require(latest != nil, "请先上传资料")
				docID = str(latest, "id")
			}
			row := a.startAIAnalysis(str(q.user, "id"), cid, docID)
			require(row != nil, "资料不存在")
			q.json(Object{"ok": true, "analysis": row})
		})
	}))
	m.HandleFunc("POST /api/clients/{cid}/retry/{jid}", a.route(func(q *request) {
		q.edit(func(cid string) {
			j := s.one("SELECT * FROM ql_jobs WHERE id=? AND customer_id=?", q.r.PathValue("jid"), cid)
			require(j != nil && str(j, "status") == "failed" && str(j, "kind") == "upload", "仅失败的上传任务可以重试；报告请重新生成")
			p := obj(str(j, "payload"))
			require(s.one("SELECT id FROM ql_documents WHERE customer_id=? AND sha=?", cid, p["sha"]) == nil, "原件已保存；请对照资料提示处理，格式更正后重新上传")
			s.exec("UPDATE ql_jobs SET status='queued',message='等待重试' WHERE id=?", j["id"])
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("GET /api/clients/{cid}/reports/{rid}/{file}", a.route(func(q *request) {
		cid := q.access()
		r := s.one("SELECT payload FROM ql_reports WHERE customer_id=? AND id=?", cid, q.r.PathValue("rid"))
		if r == nil {
			bad(404, "报告不存在")
		}
		filename := q.r.PathValue("file")
		mime := map[string]string{"report.pdf": "application/pdf", "summary.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "detail.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "report.html": "text/html; charset=utf-8"}[filename]
		if mime == "" {
			bad(404, "文件不存在")
		}
		b, e := s.read(filepath.Join(s.root, "reports", cid, q.r.PathValue("rid"), filename))
		must(e)
		if hash(b) != str(nested(obj(str(r, "payload")), "sha256"), filename) {
			bad(500, "报告完整性校验失败")
		}
		s.event(str(q.user, "id"), cid, "download_report", q.r.PathValue("rid")+"/"+filename)
		q.w.Header().Set("Content-Type", mime)
		q.w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
		_, e = q.w.Write(b)
		must(e)
	}))
	m.HandleFunc("GET /api/admin", a.route(func(q *request) {
		q.admin()
		q.json(Object{"users": s.query("SELECT id,username,display,role,active FROM ql_users ORDER BY created")})
	}))
	m.HandleFunc("GET /api/admin/audit", a.route(func(q *request) {
		q.admin()
		query := parseAuditQuery(q)
		require(len(query.Search) <= 120, "检索文字过长")
		result := auditEventsPage(s, query)
		result["actions"] = auditActionOptions()
		q.json(result)
	}))
	m.HandleFunc("POST /api/admin/users", a.route(func(q *request) {
		q.admin()
		b := q.body()
		if e := s.addUser(str(b, "username"), str(b, "display"), str(b, "password"), str(b, "role")); e != nil {
			bad(400, e.Error())
		}
		s.event(str(q.user, "id"), "", "add_user", str(b, "username"))
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("POST /api/admin/users/{uid}/toggle", a.route(func(q *request) {
		q.admin()
		uid := q.r.PathValue("uid")
		require(uid != str(q.user, "id"), "不可停用当前账号")
		s.exec("UPDATE ql_users SET active=NOT active WHERE id=?", uid)
		s.exec("DELETE FROM ql_sessions WHERE user_id=?", uid)
		s.event(str(q.user, "id"), "", "toggle_user", uid)
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("POST /api/clients/{cid}/grant", a.route(func(q *request) {
		q.admin()
		cid := q.access()
		b := q.body()
		require(s.one("SELECT id FROM ql_users WHERE id=?", b["user_id"]) != nil, "用户不存在")
		if yes(b, "revoke") {
			s.exec("DELETE FROM ql_grants WHERE customer_id=? AND user_id=?", cid, b["user_id"])
		} else {
			s.exec("INSERT IGNORE INTO ql_grants VALUES(?,?)", cid, b["user_id"])
		}
		s.event(str(q.user, "id"), cid, "change_grant", str(b, "user_id"))
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("/api/", a.route(func(q *request) { bad(404, "接口不存在") }))
	m.HandleFunc("/", a.route(func(q *request) {
		if q.r.Method != "GET" && q.r.Method != "HEAD" {
			bad(405, "不支持的请求")
		}
		path := q.r.URL.Path
		if strings.HasPrefix(path, "/assets/") || strings.HasSuffix(path, ".svg") {
			q.w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			http.FileServer(http.Dir(a.static)).ServeHTTP(q.w, q.r)
			return
		}
		if path != "/" && path != "/login" && !strings.HasPrefix(path, "/clients/") && path != "/admin" && path != "/recharge" && path != "/profile" {
			bad(404, "页面不存在")
		}
		http.ServeFile(q.w, q.r, filepath.Join(a.static, "index.html"))
	}))
	return m
}
func bytesPrefixPDF(b []byte) bool {
	if len(b) > 1024 {
		b = b[:1024]
	}
	return strings.Contains(string(b), "%PDF-")
}
func ipHost(s string) string {
	if i := strings.LastIndex(s, ":"); i >= 0 {
		return s[:i]
	}
	return s
}
func validSource(s string) bool {
	return s == "other" || s == "bank_statement" || s == "wechat_statement" || s == "alipay_statement" || s == "credit_report"
}
func (s *Store) addUser(name, display, pass, role string) error {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 60 || len(display) > 120 || len(pass) < 10 || len(pass) > 72 || (role != "sales" && role != "reviewer" && role != "admin") {
		return errors.New("账号必填、密码10至72字节，角色须有效")
	}
	if display == "" {
		display = name
	}
	h, e := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	if e != nil {
		return e
	}
	_, e = s.db.Exec("INSERT INTO ql_users(id,username,display,role,password) VALUES(?,?,?,?,?)", id(), name, display, role, string(h))
	if e != nil {
		return errors.New("账号已存在或保存失败")
	}
	return nil
}
func main() {
	syscall.Umask(0077)
	s, e := openStore()
	if e != nil {
		log.Fatal(e)
	}
	defer s.db.Close()
	if len(os.Args) > 1 && os.Args[1] == "init-admin" {
		unlock, e := s.lock(context.Background(), "setup")
		if e != nil {
			log.Fatal(e)
		}
		defer unlock()
		if s.one("SELECT id FROM ql_users LIMIT 1") != nil {
			log.Fatal("已有账号，初始化已关闭")
		}
		if e = s.addUser(os.Getenv("ADMIN_USERNAME"), "管理员", os.Getenv("ADMIN_PASSWORD"), "admin"); e != nil {
			log.Fatal(e)
		}
		fmt.Println("管理员已创建，请删除 ADMIN_PASSWORD 环境变量")
		return
	}
	origin := strings.TrimRight(os.Getenv("PUBLIC_ORIGIN"), "/")
	if origin == "" {
		log.Fatal("必须设置 PUBLIC_ORIGIN")
	}
	secure := strings.HasPrefix(origin, "https://")
	static := os.Getenv("STATIC_DIR")
	if static == "" {
		static = "frontend/dist"
	}
	if _, e = os.Stat(filepath.Join(static, "index.html")); e != nil {
		log.Fatal("找不到 React 构建产物")
	}
	a := &App{s: s, secure: secure, origin: origin, static: static, slots: make(chan struct{}, 4), wb: loadWBConfig()}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); workerLoop(ctx, s) }()
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8787"
	}
	server := &http.Server{Addr: addr, Handler: a.mux(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 120 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	go func() {
		<-ctx.Done()
		c, done := context.WithTimeout(context.Background(), 15*time.Second)
		defer done()
		_ = server.Shutdown(c)
	}()
	log.Printf("清流 listening on %s", addr)
	if e = server.ListenAndServe(); e != nil && !errors.Is(e, http.ErrServerClosed) {
		log.Fatal(e)
	}
	<-workerDone
}
