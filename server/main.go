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
	// pools 是按代价分的请求准入档，见 pool.go：静态资源与 /health 不入池，
	// 只有真吃 CPU/内存/上游等待的请求才排队，满池先等再 503。
	pools  requestPools
	wb     wbConfig
	// pricing 缓存工作台「财务 → 解析计价」的三档单价，见 pricing.go。
	pricing parsePricingCache
	// spaceNames 缓存空间 (kind:id) → 显示名与角色标签。
	// /api/me 与空间卡都要显示「当前在哪个团队、我是什么角色」，而这两个值
	// 的唯一来源是工作台的 /me/spaces；缓存避免每次页面渲染都打一次工作台。
	spaceMu    sync.Mutex
	spaceNames map[string]spaceCaption
	// refreshGates 按本地 user_id 串行化工作台 refresh：access token 约 15
	// 分钟过期，充值页顶栏与正文会并发打 /api/billing/*，若各刷一次同
	// 一个 refresh token，工作台会判定复用并吊销整个 family，页面就出现
	// 「请重新登录工作台账号」。见 docs/02-后端开发.md §5.1。
	refreshMu    sync.Mutex
	refreshGates map[string]*wbRefreshGate
}

// wbRefreshGate 让同一用户的并发 refresh 共用一次结果。
type wbRefreshGate struct {
	done  chan struct{}
	token string
	err   error
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

// space 返回本会话当前所在的空间（ql_sessions.space_kind/space_id）。
//
// 所有资料可见性判定都必须经过它：空间属于**会话**，不属于账号 ——
// 同一个人切到团队空间就能看本企业全部资料，切回个人空间只看得见自己创建的。
func (q *request) space() spaceRef {
	return spaceOf(q.session)
}

// event 把当前会话空间一起写入操作记录，避免审计跨空间越权。
func (q *request) event(cid, action, detail string) {
	if q == nil || q.app == nil || q.app.s == nil || q.user == nil {
		return
	}
	q.app.s.event(q.space(), str(q.user, "id"), cid, action, detail)
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
		bad(400, "Invalid request")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		bad(400, "Invalid request")
	}
	return v
}
func (a *App) route(fn func(*request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if e := recover(); e != nil {
				code, message := 500, "Something went wrong. Contact an administrator."
				switch v := e.(type) {
				case apiError:
					code, message = v.code, v.message
				default:
					log.Printf("request failed: %T", e)
				}
				message = localizeStoredMessage(localeFromRequest(r), message)
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
		if pool := a.poolFor(r); pool != nil {
			release, ok := pool.enter()
			if !ok {
				// 排队也没抢到槽：告诉调用方可以重试，别让浏览器把 503 当永久错误。
				w.Header().Set("Retry-After", "1")
				bad(503, "Server is busy. Please try again later.")
			}
			defer release()
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
		q := &request{w: w, r: r, app: a}
		if c, e := r.Cookie("ql_session"); e == nil {
			// 空间的唯一落点是**会话**（s.space_kind/space_id，见 migrations/005）：
			// 同一个人在工作台可能同时属于多个企业、也可能有自己的个人空间，
			// 切换后必须立刻生效，否则切了等于没切。ql_users 上已经没有空间列，
			// 所以这里也不需要 COALESCE 兜底 —— 老会话由迁移 005 回填过。
			q.session = a.s.one("SELECT s.token,s.csrf,s.space_kind,s.space_id,u.id,u.username,u.display,u.role,w.workbench_user_id,w.service_role,w.email AS wb_email,w.permissions FROM ql_sessions s JOIN ql_users u ON u.id=s.user_id LEFT JOIN ql_workbench_accounts w ON w.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1", hash([]byte(c.Value)), time.Now().Unix())
			q.user = q.session
			q.permissions = parsePermissions(str(q.session, "permissions"))
		}
		public := r.URL.Path == "/api/login" || r.URL.Path == "/api/register" ||
			r.URL.Path == "/api/auth/captcha" || r.URL.Path == "/api/auth/verification-codes" ||
			r.URL.Path == "/api/auth/reset-password" ||
			r.URL.Path == "/health" ||
			isServiceAPI(r.URL.Path)
		if strings.HasPrefix(r.URL.Path, "/api/") && !public && q.user == nil {
			bad(401, "Please sign in first")
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			// Same-origin JSON login and session-bound CSRF for every authenticated write.
			// 服务间调用（/api/service/**）用共享密钥鉴权，不走浏览器 CSRF。
			if isServiceAPI(r.URL.Path) {
				// fall through to handler
			} else if origin := r.Header.Get("Origin"); origin != "" && origin != a.origin {
				bad(403, "Request origin not allowed")
			} else if r.URL.Path == "/api/login" || r.URL.Path == "/api/register" ||
				r.URL.Path == "/api/auth/verification-codes" || r.URL.Path == "/api/auth/reset-password" {
				if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
					bad(400, "Invalid request")
				}
			} else {
				if q.session == nil || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(str(q.session, "csrf"))) != 1 {
					bad(403, "Page expired. Please refresh.")
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
		bad(403, "Admin only")
	}
}

// requireTeamSpace 挡住个人/平台空间上的团队成员写操作。
// 个人账号没有「团队新建成员」语义；要管理成员须先开通或切换到团队空间。
func (q *request) requireTeamSpace() {
	if q.space().Kind != spaceTeam {
		bad(403, "Personal space does not support team members. Open or switch to a team space.")
	}
}
func (q *request) access() string {
	cid := q.r.PathValue("cid")
	if !q.app.s.allowed(q.customerAccess(), cid) {
		bad(404, "Customer not found or no access")
	}
	return cid
}

// customerAccess 把「当前会话能看哪些客户」所需坐标打成一份，
// 交给 scopeWhere / allowed，避免列表与单客户判定各写一套。
func (q *request) customerAccess() customerAccess {
	return customerAccess{
		Space:    q.space(),
		UserID:   str(q.user, "id"),
		WBUserID: integer(q.user["workbench_user_id"]),
		Admin:    q.isAdmin(),
	}
}
func (q *request) edit(fn func(string)) {
	cid := q.access()
	unlock, e := q.app.s.lock(q.r.Context(), "case:"+cid)
	if e != nil {
		bad(409, e.Error())
	}
	defer unlock()
	if q.app.s.busy(cid) {
		bad(409, "This customer has a background job. Wait for it to finish.")
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
			bad(503, "Database unavailable")
		}
		q.json(Object{"status": "ok"})
	}))
	m.HandleFunc("POST /api/login", a.route(func(q *request) {
		b := q.body()
		name, pass, code := strings.TrimSpace(str(b, "username")), str(b, "password"), strings.TrimSpace(str(b, "code"))
		if name == "" {
			name = strings.TrimSpace(str(b, "email"))
		}
		if name == "" {
			name = strings.TrimSpace(str(b, "phone"))
		}
		require(len(name) <= 120, "账号格式无效")
		require(code != "" || (pass != "" && len(pass) <= 72), "请填写密码或邮箱验证码")
		ip := q.r.RemoteAddr
		key := hash([]byte(ipHost(ip) + "/" + name))
		unlock, e := s.lock(q.r.Context(), "login:"+key)
		if e != nil {
			bad(429, "Please try again later")
		}
		defer unlock()
		s.exec("DELETE FROM ql_login_failures WHERE at<?", time.Now().Unix()-900)
		failure := s.one("SELECT COUNT(*) AS n FROM ql_login_failures WHERE failure_key=?", key)
		if integer(failure["n"]) >= 5 {
			bad(429, "Too many attempts. Try again in 15 minutes.")
		}
		// Workbench accounts are the primary identity. A local password remains
		// as a transition fallback for the accounts created before the move; it
		// is removed once every operator has a workbench account.
		// 工作台是唯一身份来源。这里**不再静默回退**到本地密码：
		// 之前 wb.login 失败会被吞掉、接着走本地 bcrypt 校验，结果是
		// 「工作台要求验证码、本地密码却能直接登进来」——验证码形同虚设。
		// 空间落点由工作台按 membership 决定，不再传 login_mode。
		if a.wb.Ready() {
			session, err := a.wb.login(q.r.Context(), loginArgs{
				Email: name, Password: pass, Code: code,
				CaptchaID: str(b, "captcha_id"), CaptchaCode: str(b, "captcha_code"),
			})
			if err != nil {
				s.exec("INSERT INTO ql_login_failures VALUES(?,?)", key, time.Now().Unix())
				bad(401, err.Error())
			}
			uid := a.wbUpsertLocalUser(session)
			space := a.wbSaveLogin(uid, session)
			s.exec("DELETE FROM ql_login_failures WHERE failure_key=?", key)
			a.newSession(q, uid, space)
			q.json(Object{"ok": true})
			return
		}
		if code != "" {
			bad(503, "Email OTP login requires the workbench connection")
		}
		if !a.localLoginAllowed() {
			bad(503, "Workbench is not connected. Contact an administrator.")
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
			bad(401, "Incorrect account or password")
		}
		s.exec("DELETE FROM ql_login_failures WHERE failure_key=?", key)
		// 本地应急登录没有工作台会话，也就没有 current_space：落到个人空间
		// （最小权限，只看得见自己创建的）。这条路径只在工作台不可达、
		// 且显式开启 QINGLIU_ALLOW_LOCAL_LOGIN=1 时才会走到。
		a.newSession(q, str(u, "id"), spaceRef{Kind: spacePersonal})
		q.json(Object{"ok": true})
	}))
	// 空间：列出能进的空间、切换当前空间、开启一个空间（见 server/spaces.go）。
	// 三条接口都是**透传**工作台，路径保留是因为线上前端产物还在用它们。
	m.HandleFunc("GET /api/spaces", a.route(func(q *request) {
		q.json(a.spaces(q))
	}))
	m.HandleFunc("POST /api/switch-space", a.route(func(q *request) {
		q.json(a.switchSpace(q))
	}))
	m.HandleFunc("POST /api/spaces/enable", a.route(func(q *request) {
		q.json(a.enableSpace(q))
	}))
	m.HandleFunc("GET /api/me", a.route(func(q *request) {
		space := q.space()
		name, label := a.spaceLabel(q.r.Context(), str(q.user, "id"), space)
		q.json(Object{
			"user": Object{
				"id": q.user["id"], "username": q.user["username"], "display": q.user["display"], "role": q.user["role"],
				"service_code": "qingliu", "service_role": q.user["service_role"],
				// 权限码快照（工作台 RBAC 的投影）。前端按它显示/隐藏操作，
				// 服务端每个写接口仍然各判一次（q.can）。
				"permissions": q.permissionList(),
				"workbench_user_id": q.user["workbench_user_id"], "email": q.user["wb_email"],
				"workbench_linked": integer(q.user["workbench_user_id"]) > 0,
				// 当前空间：工作台契约里的 kind（personal|team|platform）+ id。
				// 这里**没有** tenant_id —— 一个人可以在多个空间之间切换，
				// 「所属团队」不是账号属性，而是工作台的成员关系。
				"space": space.Object(), "kind": space.Kind, "scope": space.Kind,
				// 空间名与角色标签：以工作台 /me/spaces 为准，清流不另起名字。
				"space_name": name, "role_label": label,
			},
			"csrf": q.session["csrf"],
		})
	}))
	// 注册相关：验证码与图形验证码都代理到工作台，浏览器不接触 service secret。
	m.HandleFunc("GET /api/auth/captcha", a.route(func(q *request) {
		if !a.wb.Ready() {
			bad(503, "Workbench is not connected")
		}
		status, data, err := a.wb.captcha(q.r.Context(), q.r.URL.Query().Get("type"))
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "Failed to load captcha"))
		}
		// 工作台返回 {id, type, svg}；清流前端统一按 captcha_id + svg 渲染，
		// 这里做一次归一化，避免前端去猜工作台的原始字段名。
		payload, _ := wbPayload(data).(map[string]any)
		if payload == nil {
			bad(503, "Invalid captcha payload")
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
			bad(503, "Workbench is not connected")
		}
		b := q.body()
		status, data, err := a.wb.verifyCode(q.r.Context(), b)
		if err != nil {
			bad(503, err.Error())
		}
		if status < 200 || status >= 300 {
			bad(status, wbMessage(data, "Failed to send verification code"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("POST /api/auth/reset-password", a.route(func(q *request) {
		if !a.wb.Ready() {
			bad(503, "Workbench is not connected")
		}
		b := q.body()
		email := strings.TrimSpace(str(b, "email"))
		require(email != "", "Enter email")
		require(strings.TrimSpace(str(b, "code")) != "", "请填写验证码")
		require(str(b, "new_password") != "", "请填写新密码")
		status, data, err := a.wb.resetPassword(q.r.Context(), Object{
			"email": email, "code": strings.TrimSpace(str(b, "code")),
			"new_password": str(b, "new_password"),
		})
		if err != nil {
			bad(503, err.Error())
		}
		if status < 200 || status >= 300 {
			bad(status, wbMessage(data, "Failed to reset password"))
		}
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("POST /api/register", a.route(func(q *request) {
		if !a.wb.Ready() {
			bad(503, "Workbench is not connected")
		}
		b := q.body()
		email := strings.TrimSpace(str(b, "email"))
		require(email != "", "Enter email")
		body := Object{
			"email": email, "phone": strings.TrimSpace(str(b, "phone")),
			"password": str(b, "password"), "code": strings.TrimSpace(str(b, "code")),
			"display_name": strings.TrimSpace(str(b, "display_name")),
			"invite_code":  strings.TrimSpace(str(b, "invite_code")),
			"service_code": "qingliu",
		}
		// 公共注册只建个人身份；企业/团队账号仍由工作台后台创建或邀请开通。
		// 不再读 login_mode：空间模型改造后客户端没有「个人/团队登录模式」可传。
		session, err := a.wb.register(q.r.Context(), body)
		if err != nil {
			bad(400, err.Error())
		}
		uid := a.wbUpsertLocalUser(session)
		space := a.wbSaveLogin(uid, session)
		a.newSession(q, uid, space)
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("GET /api/billing/skus", a.route(func(q *request) {
		if !a.wb.Ready() {
			bad(503, "Workbench is not connected")
		}
		// 走鉴权列表，带上当前空间受益账户，才能拿到 purchasable / 灰显原因。
		path := "/api/v1/payment/skus/mine?service_code=qingliu&owner_type=1"
		if space := q.space(); space.Kind == spaceTeam && space.teamID() > 0 {
			path = "/api/v1/payment/skus/mine?service_code=qingliu&owner_type=2&owner_id=" + itoa(space.teamID())
		}
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, path, nil)
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "Failed to load packages"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("POST /api/billing/orders", a.route(func(q *request) {
		b := q.body()
		payload := Object{"sku_code": str(b, "sku_code"), "service_code": "qingliu"}
		// owner_type/owner_id 决定充进个人池还是团队池；缺省保持旧客户端兼容（个人）。
		if ot := integer(b["owner_type"]); ot == 1 || ot == 2 {
			payload["owner_type"] = ot
			if ot == 2 {
				oid := integer(b["owner_id"])
				if oid <= 0 {
					oid = q.space().teamID()
				}
				require(oid > 0, "团队套餐需要先切换到团队空间")
				payload["owner_id"] = oid
			}
		}
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodPost, "/api/v1/payment/orders", payload)
		if err != nil {
			bad(503, err.Error())
		}
		if status < 200 || status >= 300 {
			bad(status, wbMessage(data, "Failed to create order"))
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
			bad(status, wbMessage(data, "Failed to load orders"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("GET /api/billing/orders/{order_no}", a.route(func(q *request) {
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, "/api/v1/payment/orders/"+q.r.PathValue("order_no"), nil)
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "Order not found"))
		}
		q.json(wbPayload(data))
	}))
	m.HandleFunc("GET /api/billing/balance", a.route(func(q *request) {
		status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, "/api/v1/account/balance", nil)
		if err != nil {
			bad(503, err.Error())
		}
		if status != http.StatusOK {
			bad(status, wbMessage(data, "Failed to load balance"))
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
			bad(status, wbMessage(data, "Failed to load ledger"))
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
				bad(400, wbMessage(data, "Current password is incorrect"))
			}
			q.event("", "change_password", "workbench")
			q.json(Object{"ok": true})
			return
		}
		u := s.one("SELECT password FROM ql_users WHERE id=?", q.user["id"])
		require(bcrypt.CompareHashAndPassword([]byte(str(u, "password")), []byte(str(b, "current_password"))) == nil, "Current password is incorrect")
		h, e := bcrypt.GenerateFromPassword([]byte(p), bcrypt.DefaultCost)
		must(e)
		s.exec("UPDATE ql_users SET password=? WHERE id=?", string(h), q.user["id"])
		s.exec("DELETE FROM ql_sessions WHERE user_id=?", q.user["id"])
		q.event("", "change_password", "")
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("GET /api/clients", a.route(func(q *request) {
		search := q.r.URL.Query().Get("q")
		require(len(search) <= 120, "Search text too long")
		page, _ := strconv.Atoi(q.r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		// 列表与 allowed() 用同一口径（团队管理员看企业全部；非管理员看授权；个人看自己的）。
		where, args := scopeWhere(q.customerAccess(), "c")
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
		_, e = tx.Exec("INSERT INTO ql_customers(id,name,payload,workspace_tenant_id,owner_user_id) VALUES(?,?,?,?,?)", cid, name, js(Object{"authorized": true, "company": str(b, "company"), "operator": q.user["display"], "rules": defaultRules(), "scope_required": true}), q.space().teamID(), str(q.user, "id"))
		must(e)
		// 创建者自带授权；团队可见性按 workbench_user_id 判。
		wbID := integer(q.user["workbench_user_id"])
		if wbID > 0 {
			_, e = tx.Exec("INSERT INTO ql_grants(customer_id,user_id,workbench_user_id) VALUES(?,?,?)", cid, q.user["id"], wbID)
		} else {
			_, e = tx.Exec("INSERT INTO ql_grants(customer_id,user_id) VALUES(?,?)", cid, q.user["id"])
		}
		must(e)
		must(tx.Commit())
		q.event(cid, "create_customer", "")
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
			job["message"] = localizeStoredMessage(localeFromRequest(q.r), str(job, "message"))
			if str(job, "status") == "queued" {
				job["queue_position"] = s.queuePosition(str(job, "id")) + 1
			}
		}
		q.json(Object{"jobs": jobs})
	}))
	a.registerUploadParsed(m)
	m.HandleFunc("POST /api/clients/{cid}/upload", a.route(func(q *request) {
		q.edit(func(cid string) {
			if e := q.r.ParseMultipartForm(2 << 20); e != nil {
				bad(400, "Upload failed; batch must be under 64MB")
			}
			defer q.r.MultipartForm.RemoveAll()
			files := q.r.MultipartForm.File["files"]
			require(len(files) >= 1 && len(files) <= 10, "每批请选择1至10份文件")
			source := q.r.FormValue("source")
			require(validSource(source), "无效来源")
			// 解析按档计费：余额不足就别收文件，避免用户等一轮才发现扣不了费。
			// 读不到余额（工作台不可达）时放行，不能因为计费故障阻断业务。
			if balance, ok := a.pointBalance(q.r.Context(), str(q.user, "id")); ok && balance <= 0 {
				bad(402, insufficientPointsMessage)
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
				require(f.Size > 0 && f.Size <= 30<<20, "Each file must be 1 byte–30MB")
				name := filepath.Base(strings.ReplaceAll(f.Filename, "\\", "/"))
				ext := strings.ToLower(filepath.Ext(name))
				require((ext == ".pdf" || ext == ".csv" || ext == ".xlsx") && len([]rune(name)) <= 240, "仅支持PDF、CSV、XLSX文件")
				stream, e := f.Open()
				must(e)
				b, e := io.ReadAll(io.LimitReader(stream, (30<<20)+1))
				stream.Close()
				must(e)
				require(len(b) <= 30<<20, "File exceeds 30MB")
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
			space := q.space()
			for _, p := range payloads {
				// 任务带上提交时的空间：worker 在没有会话的情况下重跑它，
				// 必须按同一个空间判权限（见 migrations/005）。
				_, e = tx.Exec("INSERT INTO ql_jobs(id,customer_id,user_id,kind,status,payload,message,progress,stage,upload_batch,space_kind,space_id) VALUES(?,?,?,'upload','queued',?,'已进入队列，等待解析',0,'queued',?,?,?)", p["id"], cid, q.user["id"], js(p), batch, space.Kind, space.ID)
				must(e)
				jobIDs = append(jobIDs, str(p, "id"))
			}
			must(tx.Commit())
			committed = true
			s.bump(cid)
			q.event(cid, "upload_queued", fmt.Sprint(len(payloads)))
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
				require(strings.TrimSpace(str(sc, "holder")) != "" && (rel == "Self" || rel == "配偶" || rel == "子女" || rel == "Other"), "每份资料须填写持有人及关系")
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
			q.event(cid, "confirm_ownership", "")
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
			q.event(cid, "confirm_period", js(fields["web_period"]))
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
			q.event(cid, "update_rules", "")
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
				require(t != nil && !yes(t, "scope_excluded") && str(t, "quality") != "invalid", "Record not in reviewable range; fix amounts in the file")
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
			q.event(cid, "review_transactions", fmt.Sprint(len(changes)))
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("GET /api/clients/{cid}/transaction/{tid}", a.route(func(q *request) {
		cid := q.access()
		for _, t := range s.rows(cid) {
			if str(t, "id") == q.r.PathValue("tid") {
				q.event(cid, "view_original", str(t, "id"))
				q.json(Object{"row": t, "audits": s.query("SELECT label,operator,reason,created FROM ql_reviews WHERE transaction_id=? ORDER BY seq", t["id"])})
				return
			}
		}
		bad(404, "Transaction not found")
	}))
	m.HandleFunc("GET /api/clients/{cid}/original/{did}/{page}", a.route(func(q *request) {
		cid := q.access()
		did := q.r.PathValue("did")
		d := s.one("SELECT name,sha,payload FROM ql_documents WHERE customer_id=? AND id=?", cid, did)
		if d == nil || strings.ToLower(filepath.Ext(str(d, "name"))) != ".pdf" {
			bad(404, "Original PDF not found")
		}
		page, e := strconv.Atoi(q.r.PathValue("page"))
		if e != nil || page < 1 || page > int(integer(obj(str(d, "payload"))["pages"])) {
			bad(404, "Invalid page number")
		}
		etag := `"` + str(d, "sha") + ":" + fmt.Sprint(page) + `"`
		q.w.Header().Set("ETag", etag)
		q.w.Header().Set("X-Document-SHA", str(d, "sha"))
		q.w.Header().Set("Cache-Control", "private, max-age=3600")
		if match := strings.TrimSpace(q.r.Header.Get("If-None-Match")); match != "" && match == etag {
			q.w.WriteHeader(http.StatusNotModified)
			return
		}
		b, e := s.read(filepath.Join(s.root, "uploads", cid, did))
		must(e)
		ctx, cancel := context.WithTimeout(q.r.Context(), 30*time.Second)
		defer cancel()
		png, e := pdfPage(ctx, b, page)
		must(e)
		q.event(cid, "view_original_page", did+":"+fmt.Sprint(page))
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
			q.event(cid, "submit_review", "")
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
					bad(403, "Only reviewers or admins can issue")
				}
				require(len(d["problems"].([]string)) == 0 && yes(d, "submitted_current") && yes(b, "attest") && strings.TrimSpace(str(b, "statement")) != "", "Finish file review, submit for review, and fill the review statement")
			}
			jid := id()
			payload := Object{"stage": stage, "revision": nested(d, "customer")["revision"], "source": d["source"], "start": d["start"], "end": d["end"], "statement": str(b, "statement"), "operator": q.user["display"]}
			space := q.space()
			s.exec("INSERT INTO ql_jobs(id,customer_id,user_id,kind,status,payload,message,space_kind,space_id) VALUES(?,?,?,'report','queued',?,'等待生成报告',?,?)", jid, cid, q.user["id"], js(payload), space.Kind, space.ID)
			q.event(cid, "report_queued", jid)
			q.json(Object{"id": jid})
		})
	}))
	m.HandleFunc("GET /api/clients/{cid}/ai-analysis", a.route(func(q *request) {
		cid := q.access()
		q.json(Object{"items": a.latestAIAnalyses(cid, 10)})
	}))
	m.HandleFunc("POST /api/clients/{cid}/ai-analysis", a.route(func(q *request) {
		q.edit(func(cid string) {
			// AI 解析按实际用量扣积分：余额为 0 时先提示充值，别让用户走到
			// 「请先上传资料」或提交后才吃 402。与上传解析同一条口径——
			// 读不到余额（工作台不可达）时放行。
			if balance, ok := a.pointBalance(q.r.Context(), str(q.user, "id")); ok && balance <= 0 {
				bad(402, insufficientPointsMessage)
			}
			b := q.body()
			docID := strings.TrimSpace(str(b, "document_id"))
			require(docID != "", "Select a document to analyze")
			// task=page_ocr 时走工作台的「文档视觉识别」，适合扫描件/图片型流水。
			task := strings.TrimSpace(str(b, "task"))
			if task != "page_ocr" {
				task = ""
			}
			row := a.startAIAnalysis(str(q.user, "id"), cid, docID, task, q.space())
			require(row != nil, "Document not found")
			q.json(Object{"ok": true, "analysis": row})
		})
	}))
	// S6：手动把某次 page_ocr 转写写回核对（自动路径失败时补刀）。
	m.HandleFunc("POST /api/clients/{cid}/ai-writeback", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			analysisID := strings.TrimSpace(str(b, "analysis_id"))
			require(analysisID != "", "Specify an analysis result")
			row := s.one("SELECT status,result,document_id FROM ql_ai_analyses WHERE id=? AND customer_id=?", analysisID, cid)
			require(row != nil && str(row, "status") == "done", "Analysis incomplete or missing")
			result := obj(str(row, "result"))
			docID := str(row, "document_id")
			doc := s.one("SELECT name FROM ql_documents WHERE id=? AND customer_id=?", docID, cid)
			require(doc != nil, "Document not found")
			n, err := a.writebackPageOCR(cid, docID, str(doc, "name"), result)
			if err != nil {
				bad(400, err.Error())
			}
			q.event(cid, "ai_writeback", fmt.Sprint(n))
			q.json(Object{"ok": true, "rows": n})
		})
	}))
	// 把已完成分析结果里带 transaction_id 的条目写成交易行 ai_* 预勾（不改正式标签）。
	m.HandleFunc("POST /api/clients/{cid}/ai-suggest", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			analysisID := strings.TrimSpace(str(b, "analysis_id"))
			require(analysisID != "", "Specify an analysis result")
			row := s.one("SELECT status,result FROM ql_ai_analyses WHERE id=? AND customer_id=?", analysisID, cid)
			require(row != nil && str(row, "status") == "done", "Analysis incomplete or missing")
			result := obj(str(row, "result"))
			known := map[string]bool{}
			allRows := s.rows(cid)
			for _, t := range allRows {
				known[str(t, "id")] = true
			}
			n := s.applyAISuggestions(cid, suggestionsFromAnalysisRows(result, known, allRows))
			q.event(cid, "ai_suggest", fmt.Sprint(n))
			q.json(Object{"ok": true, "applied": n})
		})
	}))
	// 一键采纳本页/全案高置信 suggested → 写入 ql_reviews，ai_status=adopted。
	m.HandleFunc("POST /api/clients/{cid}/ai-adopt", a.route(func(q *request) {
		q.edit(func(cid string) {
			candidates := highConfidenceSuggested(s.rows(cid))
			require(len(candidates) > 0, "没有可采纳的高置信建议")
			require(len(candidates) <= 50, "一次最多采纳 50 笔，请分批")
			tx, e := s.db.Begin()
			must(e)
			defer tx.Rollback()
			for _, t := range candidates {
				tid := str(t, "id")
				label := str(t, "ai_label")
				reason := firstNonEmpty(str(t, "ai_reason"), "ai_adopted")
				_, e = tx.Exec("INSERT INTO ql_reviews(transaction_id,label,operator,reason) VALUES(?,?,?,?)", tid, label, q.user["display"], "ai_adopted: "+reason)
				must(e)
			}
			must(tx.Commit())
			for _, t := range candidates {
				tid := str(t, "id")
				raw := s.one("SELECT payload FROM ql_transactions WHERE id=? AND customer_id=?", tid, cid)
				if raw == nil {
					continue
				}
				payload := obj(str(raw, "payload"))
				payload["ai_status"] = aiStatusAdopted
				s.exec("UPDATE ql_transactions SET payload=? WHERE id=? AND customer_id=?", js(payload), tid, cid)
			}
			s.bump(cid)
			q.event(cid, "ai_adopt", fmt.Sprint(len(candidates)))
			q.json(Object{"ok": true, "adopted": len(candidates)})
		})
	}))
	// 撤销 AI 采纳：若最近一条 review 是 ai_adopted，回退并清 ai_status。
	m.HandleFunc("POST /api/clients/{cid}/ai-revoke", a.route(func(q *request) {
		q.edit(func(cid string) {
			b := q.body()
			ids := list(b["ids"])
			require(len(ids) > 0 && len(ids) <= 50, "请选择 1 至 50 笔")
			n := 0
			for _, v := range ids {
				tid := text(v)
				raw := s.one("SELECT payload FROM ql_transactions WHERE id=? AND customer_id=?", tid, cid)
				if raw == nil {
					continue
				}
				payload := obj(str(raw, "payload"))
				if str(payload, "ai_status") != aiStatusAdopted && str(payload, "ai_status") != aiStatusSuggested {
					continue
				}
				latest := s.one("SELECT seq,label,reason FROM ql_reviews WHERE transaction_id=? ORDER BY seq DESC LIMIT 1", tid)
				if latest != nil && strings.HasPrefix(str(latest, "reason"), "ai_adopted") {
					s.exec("INSERT INTO ql_reviews(transaction_id,label,operator,reason) VALUES(?,?,?,?)", tid, "unreviewed", q.user["display"], "ai_revoked")
				}
				payload["ai_status"] = aiStatusNone
				s.exec("UPDATE ql_transactions SET payload=? WHERE id=? AND customer_id=?", js(payload), tid, cid)
				n++
			}
			require(n > 0, "没有可撤销的 AI 建议")
			s.bump(cid)
			q.event(cid, "ai_revoke", fmt.Sprint(n))
			q.json(Object{"ok": true, "revoked": n})
		})
	}))
	m.HandleFunc("POST /api/clients/{cid}/jobs/{jid}/cancel", a.route(func(q *request) {
		cid := q.access()
		j := s.one("SELECT * FROM ql_jobs WHERE id=? AND customer_id=?", q.r.PathValue("jid"), cid)
		require(j != nil, "Job not found")
		status := str(j, "status")
		require(status == "queued" || status == "running", "Only queued or running jobs can be cancelled")
		jid := str(j, "id")
		// 取消只写终态，不试图强杀 goroutine：执行器会在下一次阶段回调
		// 或超时后自行退出；busy() 立刻为假，用户不必等它跑完。
		s.jobFinish(jid, "failed", "Cancelled by user")
		// 只收掉本任务对应的 AI 分析；禁止一刀切掉该客户其它进行中的分析。
		if str(j, "kind") == "ai_analysis" {
			payload := obj(str(j, "payload"))
			analysisID := str(payload, "analysis_id")
			if analysisID != "" {
				s.exec("UPDATE ql_ai_analyses SET status='failed',stage='failed',error='已手动终止',completed=NOW(6) WHERE id=? AND status IN ('queued','running','uploading')", analysisID)
				// 双边 cancel：通知工作台打断执行循环，避免清流停了后台仍扣费。
				row := s.one("SELECT workbench_analysis_id FROM ql_ai_analyses WHERE id=?", analysisID)
				if row != nil {
					if wbID := integer(row["workbench_analysis_id"]); wbID > 0 {
						_, _, _ = a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodPost, "/api/v1/ai/analyses/"+itoa(wbID)+"/cancel", Object{})
					}
				}
			}
		}
		q.event(cid, "job_cancelled", jid)
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("POST /api/clients/{cid}/retry/{jid}", a.route(func(q *request) {
		q.edit(func(cid string) {
			j := s.one("SELECT * FROM ql_jobs WHERE id=? AND customer_id=?", q.r.PathValue("jid"), cid)
			require(j != nil && str(j, "status") == "failed" && str(j, "kind") == "upload", "Only failed upload jobs can be retried; regenerate reports instead")
			p := obj(str(j, "payload"))
			require(s.one("SELECT id FROM ql_documents WHERE customer_id=? AND sha=?", cid, p["sha"]) == nil, "Original saved; follow file tips, fix format, then re-upload")
			s.exec("UPDATE ql_jobs SET status='queued',message='等待重试' WHERE id=?", j["id"])
			q.json(Object{"ok": true})
		})
	}))
	m.HandleFunc("GET /api/clients/{cid}/reports/{rid}/{file}", a.route(func(q *request) {
		cid := q.access()
		r := s.one("SELECT payload FROM ql_reports WHERE customer_id=? AND id=?", cid, q.r.PathValue("rid"))
		if r == nil {
			bad(404, "Report not found")
		}
		filename := q.r.PathValue("file")
		mime := map[string]string{"report.pdf": "application/pdf", "summary.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "detail.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "report.html": "text/html; charset=utf-8"}[filename]
		if mime == "" {
			bad(404, "File not found")
		}
		b, e := s.read(filepath.Join(s.root, "reports", cid, q.r.PathValue("rid"), filename))
		must(e)
		if hash(b) != str(nested(obj(str(r, "payload")), "sha256"), filename) {
			bad(500, "报告完整性校验失败")
		}
		q.event(cid, "download_report", q.r.PathValue("rid")+"/"+filename)
		q.w.Header().Set("Content-Type", mime)
		q.w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
		_, e = q.w.Write(b)
		must(e)
	}))
	m.HandleFunc("GET /api/admin", a.route(func(q *request) {
		q.admin()
		// 「他是哪个团队的成员」以工作台为准；清流只同步本地账号供授权表引用。
		// 旧实现 JOIN ql_grants，没被授过客户权的成员永远不出现。
		q.json(Object{"users": a.listWorkbenchMembers(q)})
	}))
	m.HandleFunc("GET /api/admin/audit", a.route(func(q *request) {
		q.admin()
		query := parseAuditQuery(q)
		query.Space = q.space()
		query.Actor = str(q.user, "id")
		require(len(query.Search) <= 120, "Search text too long")
		result := auditEventsPage(s, query)
		result["actions"] = auditActionOptions()
		q.json(result)
	}))
	a.registerServiceAuditRoutes(m)
	m.HandleFunc("POST /api/admin/users", a.route(func(q *request) {
		q.admin()
		b := q.body()
		a.createWorkbenchMember(q, str(b, "username"), str(b, "display"), str(b, "password"), str(b, "role"))
		q.event("", "add_user", str(b, "username"))
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("POST /api/admin/users/{uid}/toggle", a.route(func(q *request) {
		q.admin()
		uid := q.r.PathValue("uid")
		a.toggleWorkbenchMember(q, uid)
		q.event("", "toggle_user", uid)
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("POST /api/admin/users/{uid}/delete", a.route(func(q *request) {
		q.admin()
		uid := q.r.PathValue("uid")
		b := q.body()
		a.removeWorkbenchMember(q, uid, str(b, "password"))
		q.event("", "remove_user", uid)
		q.json(Object{"ok": true})
	}))
	m.HandleFunc("POST /api/clients/{cid}/grant", a.route(func(q *request) {
		q.admin()
		q.requireTeamSpace()
		cid := q.access()
		b := q.body()
		localID, wbID := resolveGrantSubject(s, b)
		if yes(b, "revoke") {
			s.exec("DELETE FROM ql_grants WHERE customer_id=? AND (user_id=? OR workbench_user_id=?)", cid, localID, wbID)
		} else {
			s.exec(`INSERT INTO ql_grants(customer_id,user_id,workbench_user_id) VALUES(?,?,?)
 ON DUPLICATE KEY UPDATE workbench_user_id=VALUES(workbench_user_id)`, cid, localID, wbID)
		}
		q.event(cid, "change_grant", "wb:"+itoa(wbID))
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
			bad(404, "Page not found")
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
		return errors.New("Account required; password 10–72 bytes; role must be valid")
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
		if e = s.addUser(os.Getenv("ADMIN_USERNAME"), "Admin", os.Getenv("ADMIN_PASSWORD"), "admin"); e != nil {
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
	a := &App{s: s, secure: secure, origin: origin, static: static, pools: loadRequestPools(), wb: loadWBConfig()}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	startAuditRetention(ctx, s)
	startColdDataRetention(ctx, s)
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

// customerAccess 是客户可见性的唯一入参（空间 + 身份 + 是否管理员）。
type customerAccess struct {
	Space    spaceRef
	UserID   string // 本地影子 subject（个人归属 / 未绑定时的授权兜底）
	WBUserID int64  // 工作台 t_user.id；团队非管理员授权按此列
	Admin    bool
}

// scopeWhere 生成「当前空间能看到哪些资料」的 SQL 条件。
//
// 账号真相在工作台；清流只保留客户授权绑定：
//   - 团队 + 管理员：本企业全部客户
//   - 团队 + 非管理员：本企业且 ql_grants.workbench_user_id 命中
//   - 个人/平台：自己创建的，或被显式授权的（复核场景）
//
// alias 是客户表在查询里的别名；授权判定与列表查询必须用同一口径，
// 否则会出现「列表里看不到、直接输 ID 却能打开」的越权。
func scopeWhere(access customerAccess, alias string) (string, []any) {
	if access.Space.Kind == spaceTeam {
		if access.Admin {
			return alias + ".workspace_tenant_id=?", []any{access.Space.ID}
		}
		if access.WBUserID <= 0 {
			return "1=0", nil
		}
		return alias + ".workspace_tenant_id=? AND EXISTS (SELECT 1 FROM ql_grants g WHERE g.customer_id=" + alias + ".id AND g.workbench_user_id=?)",
			[]any{access.Space.ID, access.WBUserID}
	}
	own := "(" + alias + ".workspace_tenant_id=0 AND " + alias + ".owner_user_id=?)"
	if access.WBUserID > 0 {
		return "(" + own + " OR EXISTS (SELECT 1 FROM ql_grants g WHERE g.customer_id=" + alias + ".id AND g.workbench_user_id=?))",
			[]any{access.UserID, access.WBUserID}
	}
	return "(" + own + " OR EXISTS (SELECT 1 FROM ql_grants g WHERE g.customer_id=" + alias + ".id AND g.user_id=?))",
		[]any{access.UserID, access.UserID}
}

// resolveGrantSubject 把授权请求里的工作台 id（优先）或本地影子 id 解析成双写所需坐标。
func resolveGrantSubject(s *Store, b Object) (localID string, wbID int64) {
	wbID = integer(b["workbench_user_id"])
	if wbID > 0 {
		row := s.one("SELECT user_id FROM ql_workbench_accounts WHERE workbench_user_id=?", wbID)
		require(row != nil, "User not found or not linked to workbench")
		return str(row, "user_id"), wbID
	}
	localID = strings.TrimSpace(str(b, "user_id"))
	require(localID != "" && s.one("SELECT id FROM ql_users WHERE id=?", localID) != nil, "User not found")
	if account := s.one("SELECT workbench_user_id FROM ql_workbench_accounts WHERE user_id=?", localID); account != nil {
		wbID = integer(account["workbench_user_id"])
	}
	require(wbID > 0, "用户未绑定工作台，无法分配客户权限")
	return localID, wbID
}

// localLoginAllowed 决定是否允许「本地密码」这条过渡路径。
//
// 默认关闭：工作台才是身份来源，本地密码是两套密码两套风险，还会绕过
// 工作台的人机验证。只有在显式设置 QINGLIU_ALLOW_LOCAL_LOGIN=1 时才开放，
// 用于工作台不可达时的应急运维。
func (a *App) localLoginAllowed() bool {
	return strings.TrimSpace(os.Getenv("QINGLIU_ALLOW_LOCAL_LOGIN")) == "1"
}
