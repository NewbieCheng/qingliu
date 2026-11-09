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
	"sync"
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
	// pricing 缓存工作台「财务 → 解析计价」的三档单价，见 pricing.go。
	pricing parsePricingCache
	// tenantNames 缓存租户 id → 公司名，避免每次 /api/me 都请求工作台。
	tenantMu    sync.Mutex
	tenantNames map[int64]string
}
type request struct {
	w       http.ResponseWriter
	r       *http.Request
	user    Object
	session Object
	app     *App
	// permissions 是工作台权限码快照（见 server/permissions.go）。
	// 为 nil 表示「没有快照」（本地过渡账号 / 迁移前登录），此时退回
	// ql_users.role 的三档判定，行为与改造前一致。
	permissions map[string]bool
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
			// tenant_id/tenant_role 必须一起取出来：资料隔离的授权口径依赖它们，
			// 漏选会让所有团队账号退化成「个人空间」，看到的是别人的资料。
			// 空间以**会话**为准（s.tenant_id，见 migrations/004）：一个人在工作台
			// 可能同时属于多个企业，也可能同时有自己的个人空间，登录时定死的那一个
			// 只是「默认空间」，切换后必须立刻生效，否则切了等于没切。
			// COALESCE 是给迁移前的老会话兜底：它们没有 s.tenant_id，沿用用户列。
			q.session = a.s.one("SELECT s.token,s.csrf,s.tenant_id AS space_tenant_id,COALESCE(NULLIF(s.tenant_id,0),u.tenant_id) AS tenant_id,u.id,u.username,u.display,u.role,u.tenant_id AS home_tenant_id,u.tenant_role,w.workbench_user_id,w.service_role,w.email AS wb_email,w.permissions FROM ql_sessions s JOIN ql_users u ON u.id=s.user_id LEFT JOIN ql_workbench_accounts w ON w.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1", hash([]byte(c.Value)), time.Now().Unix())
			q.user = q.session
			q.permissions = parsePermissions(str(q.session, "permissions"))
		}
		public := r.URL.Path == "/api/login" || r.URL.Path == "/api/register" ||
			r.URL.Path == "/api/auth/captcha" || r.URL.Path == "/api/auth/verification-codes" ||
			r.URL.Path == "/health"
		if strings.HasPrefix(r.URL.Path, "/api/") && !public && q.user == nil {
			bad(401, "请先登录")
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			// Same-origin JSON login and session-bound CSRF for every authenticated write.
			if origin := r.Header.Get("Origin"); origin != "" && origin != a.origin {
				bad(403, "请求来源不允许")
			}
			if r.URL.Path == "/api/login" || r.URL.Path == "/api/register" || r.URL.Path == "/api/auth/verification-codes" {
				if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
					bad(400, "请求格式无效")
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
// admin 只保留一个薄壳，判定交给 permissions.go。
//
// 改造前它读 ql_users.role（清流自己的三档字符串），于是工作台上被降成
// enterprise_member_readonly 的人在清流里仍然是 admin。现在读的是工作台
// 权限快照，没有快照（本地过渡账号）时才退回旧的 role 判定。
func (q *request) admin() {
	if !q.isAdmin() {
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
		if name == "" {
			name = strings.TrimSpace(str(b, "email"))
		}
		if name == "" {
			name = strings.TrimSpace(str(b, "phone"))
		}
		require(len(name) <= 120 && len(pass) <= 72, "账号或密码格式无效")
		// 登录模式：1=个人，2=团队。团队账号由工作台后台创建，清流只负责登录。
		mode := integer(b["login_mode"])
		if mode == 0 {
			mode = integer(b["mode"])
		}
		if mode != 2 {
			mode = 1
		}
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
		// 工作台是唯一身份来源。这里**不再静默回退**到本地密码：
		// 之前 wb.login 失败会被吞掉、接着走本地 bcrypt 校验，结果是
		// 「工作台要求验证码、本地密码却能直接登进来」——验证码形同虚设。
		if a.wb.Ready() {
			captchaID, captchaCode := str(b, "captcha_id"), str(b, "captcha_code")
			session, err := a.wb.login(q.r.Context(), name, pass, int(mode), captchaID, captchaCode)
			if err != nil {
				s.exec("INSERT INTO ql_login_failures VALUES(?,?)", key, time.Now().Unix())
				bad(401, err.Error())
			}
			uid := a.wbUpsertLocalUser(session)
			a.wbSaveLogin(uid, session)
			s.exec("DELETE FROM ql_login_failures WHERE failure_key=?", key)
			a.newSession(q, uid)
			q.json(Object{"ok": true})
			return
		}
		if !a.localLoginAllowed() {
			bad(503, "尚未接入工作台，请联系管理员")
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
	// 空间：列出能进的空间、切换当前空间（见 server/space.go，migrations/004）。
	// 切换只改**本会话**，不影响同一个人在其他设备上的登录。
	m.HandleFunc("GET /api/spaces", a.route(func(q *request) {
		q.json(a.spaces(q))
	}))
	m.HandleFunc("POST /api/switch-space", a.route(func(q *request) {
		q.json(a.switchSpace(q))
	}))
	m.HandleFunc("GET /api/me", a.route(func(q *request) {
		q.json(Object{
			"user": Object{
				"id": q.user["id"], "username": q.user["username"], "display": q.user["display"], "role": q.user["role"],
				"service_code": "qingliu", "service_role": q.user["service_role"],
				// 权限码快照（工作台 RBAC 的投影）。前端按它显示/隐藏操作，
				// 服务端每个写接口仍然各判一次（q.can）。
				"permissions": q.permissionList(),
				"workbench_user_id": q.user["workbench_user_id"], "email": q.user["wb_email"],
				"workbench_linked": integer(q.user["workbench_user_id"]) > 0,
				// 资料归属维度：0=个人空间，>0=公司团队。前端据此提示当前范围。
				"tenant_id": q.user["tenant_id"], "tenant_role": q.user["tenant_role"],
				"scope": tenantScope(q.user),
				// 所属团队/公司名称：账号页要明确告诉用户「你在哪个团队」。
				// 名称以工作台 t_tenant 为准，两边是同一家公司，不另起名字。
				"tenant_name": a.tenantName(q.r.Context(), q.user),
			},
			"csrf": q.session["csrf"],
		})
	}))
	// 注册相关：验证码与图形验证码都代理到工作台，浏览器不接触 service secret。
	m.HandleFunc("GET /api/auth/captcha", a.route(func(q *request) {
		if !a.wb.Ready() {
			bad(503, "尚未接入工作台")
		}
		status, data, err := a.wb.captcha(q.r.Context(), q.r.URL.Query().Get("type"))
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "验证码加载失败"))
		}
		// 工作台返回 {id, type, svg}；清流前端统一按 captcha_id + svg 渲染，
		// 这里做一次归一化，避免前端去猜工作台的原始字段名。
		payload, _ := wbPayload(data).(map[string]any)
		if payload == nil {
			bad(503, "验证码格式异常")
		}
		q.json(Object{
			"captcha_id":  str(payload, "id"),
			"type":        str(payload, "type"),
			"svg":         str(payload, "svg"),
			"prompt":      str(payload, "prompt"),
			"icon_target": str(payload, "icon_target"),
			"sequence":    payload["sequence"],
			// objects 是每个图标的 id/kind/尺寸，前端据此渲染可点区域。
			"objects": payload["objects"],
		})
	}))
	m.HandleFunc("POST /api/auth/verification-codes", a.route(func(q *request) {
		if !a.wb.Ready() {
			bad(503, "尚未接入工作台")
		}
		b := q.body()
		status, data, err := a.wb.verifyCode(q.r.Context(), b)
		if err != nil {
			bad(503, err.Error())
		}
		if status < 200 || status >= 300 {
			bad(status, wbMessage(data, "验证码发送失败"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("POST /api/register", a.route(func(q *request) {
		if !a.wb.Ready() {
			bad(503, "尚未接入工作台")
		}
		b := q.body()
		email := strings.TrimSpace(str(b, "email"))
		require(email != "", "请填写邮箱")
		body := Object{
			"email": email, "phone": strings.TrimSpace(str(b, "phone")),
			"password": str(b, "password"), "code": strings.TrimSpace(str(b, "code")),
			"display_name": strings.TrimSpace(str(b, "display_name")),
			"invite_code":  strings.TrimSpace(str(b, "invite_code")),
			"service_code": "qingliu",
		}
		// 团队注册暂不开放：公司由工作台后台创建，清流只提供团队登录。
		require(integer(b["login_mode"]) != 2, "团队账号请由管理员在工作台后台创建")
		session, err := a.wb.register(q.r.Context(), body)
		if err != nil {
			bad(400, err.Error())
		}
		uid := a.wbUpsertLocalUser(session)
		a.wbSaveLogin(uid, session)
		a.newSession(q, uid)
		q.json(Object{"ok": true})
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
		// 列表与 allowed() 用同一口径：团队看整个团队，个人只看自己的。
		where, args := scopeWhere(q.user, "c")
		where += " AND c.name LIKE ?"
		args = append(args, "%"+search+"%")
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
		_, e = tx.Exec("INSERT INTO ql_customers(id,name,payload,workspace_tenant_id,owner_user_id) VALUES(?,?,?,?,?)", cid, name, js(Object{"authorized": true, "company": str(b, "company"), "operator": q.user["display"], "rules": defaultRules(), "scope_required": true}), integer(q.user["tenant_id"]), str(q.user, "id"))
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
		jobs := s.query("SELECT id,kind,status,message,progress,stage,created FROM ql_jobs WHERE customer_id=? ORDER BY seq DESC LIMIT 30", cid)
		// 排队中的任务附带「前面还有几份」：串行解析时用户最想知道的是这个，
		// 而不是一个笼统的「排队中」。
		for _, job := range jobs {
			if str(job, "status") == "queued" {
				job["queue_position"] = s.queuePosition(str(job, "id")) + 1
			}
		}
		q.json(Object{"jobs": jobs})
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
			// 解析按档计费：余额不足就别收文件，避免用户等一轮才发现扣不了费。
			// 读不到余额（工作台不可达）时放行，不能因为计费故障阻断业务。
			if balance, ok := a.pointBalance(q.r.Context(), str(q.user, "id")); ok && balance <= 0 {
				bad(402, "积分不足，无法解析；请联系管理员充值后再上传")
			}
			// 批次幂等：浏览器生成 batch 键，断网重试同一批次直接回放，不重复建任务。
			batch := strings.TrimSpace(q.r.FormValue("batch"))
			if len(batch) > 64 {
				batch = batch[:64]
			}
			if batch != "" {
				if done := s.one("SELECT payload FROM ql_upload_batches WHERE customer_id=? AND batch=?", cid, batch); done != nil {
					q.json(obj(str(done, "payload")))
					return
				}
			}
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
			jobIDs := []string{}
			for _, p := range payloads {
				_, e = tx.Exec("INSERT INTO ql_jobs(id,customer_id,user_id,kind,status,payload,message,progress,stage,upload_batch) VALUES(?,?,?,'upload','queued',?,'已进入队列，等待解析',0,'queued',?)", p["id"], cid, q.user["id"], js(p), batch)
				must(e)
				jobIDs = append(jobIDs, str(p, "id"))
			}
			must(tx.Commit())
			committed = true
			s.bump(cid)
			s.event(str(q.user, "id"), cid, "upload_queued", fmt.Sprint(len(payloads)))
			result := Object{"ok": true, "jobs": jobIDs, "batch": batch}
			if batch != "" {
				s.exec("INSERT INTO ql_upload_batches(customer_id,batch,payload) VALUES(?,?,?) ON DUPLICATE KEY UPDATE payload=payload", cid, batch, js(result))
			}
			q.json(result)
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
				if !q.canSignReport() {
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
			// task=page_ocr 时走工作台的「文档视觉识别」，适合扫描件/图片型流水。
			task := strings.TrimSpace(str(b, "task"))
			if task != "page_ocr" {
				task = ""
			}
			row := a.startAIAnalysis(str(q.user, "id"), cid, docID, task)
			require(row != nil, "资料不存在")
			q.json(Object{"ok": true, "analysis": row})
		})
	}))
	m.HandleFunc("POST /api/clients/{cid}/jobs/{jid}/cancel", a.route(func(q *request) {
		cid := q.access()
		j := s.one("SELECT * FROM ql_jobs WHERE id=? AND customer_id=?", q.r.PathValue("jid"), cid)
		require(j != nil, "任务不存在")
		status := str(j, "status")
		require(status == "queued" || status == "running", "只有排队中或执行中的任务可以终止")
		jid := str(j, "id")
		// 取消只写终态，不试图强杀 goroutine：执行器会在下一次阶段回调
		// 或超时后自行退出；busy() 立刻为假，用户不必等它跑完。
		s.jobFinish(jid, "failed", "已手动终止")
		s.exec("UPDATE ql_ai_analyses SET status='failed',stage='failed',error='已手动终止',completed=NOW(6) WHERE customer_id=? AND status IN ('queued','running','uploading')", cid)
		s.event(str(q.user, "id"), cid, "job_cancelled", jid)
		q.json(Object{"ok": true})
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
		// 用户列表同样受资料隔离约束：管理员只看到自己空间的人，
		// 否则「谁能看谁」在人员维度上又开了一个口子。
		if tenant := integer(q.user["tenant_id"]); tenant > 0 {
			q.json(Object{"users": s.query("SELECT id,username,display,role,active,tenant_id FROM ql_users WHERE tenant_id=? ORDER BY created", tenant)})
			return
		}
		q.json(Object{"users": s.query("SELECT id,username,display,role,active,tenant_id FROM ql_users WHERE id=? ORDER BY created", str(q.user, "id"))})
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
	restrictUmask()
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
	go func() { defer close(workerDone); workerLoop(ctx, s, a) }()
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

// tenantScope 把租户维度翻译成前端可读的范围名。
func tenantScope(user Object) string {
	if integer(user["tenant_id"]) > 0 {
		return "team"
	}
	return "personal"
}

// scopeWhere 生成「这个用户能看到哪些资料」的 SQL 条件。
//
// 团队账号（tenant_id>0）看整个团队的资料；个人账号（tenant_id=0）只看自己
// 创建的资料 —— 个人本身就是他自己的一个空间，与他人互不可见。
// alias 是客户表在查询里的别名，两处调用（授权判定与列表）必须用同一口径，
// 否则会出现「列表里看不到、直接输 ID 却能打开」的越权。
func scopeWhere(user Object, alias string) (string, []any) {
	if tenant := integer(user["tenant_id"]); tenant > 0 {
		return alias + ".workspace_tenant_id=?", []any{tenant}
	}
	return "(" + alias + ".workspace_tenant_id=0 AND " + alias + ".owner_user_id=?)", []any{str(user, "id")}
}

// localLoginAllowed 决定是否允许「本地密码」这条过渡路径。
//
// 默认关闭：工作台才是身份来源，本地密码是两套密码两套风险，还会绕过
// 工作台的人机验证。只有在显式设置 QINGLIU_ALLOW_LOCAL_LOGIN=1 时才开放，
// 用于工作台不可达时的应急运维。
func (a *App) localLoginAllowed() bool {
	return strings.TrimSpace(os.Getenv("QINGLIU_ALLOW_LOCAL_LOGIN")) == "1"
}
