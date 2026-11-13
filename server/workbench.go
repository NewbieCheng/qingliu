package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// wbConfig is the server-side bridge to the workbench. The browser never sees
// the service secret or the workbench access/refresh tokens.
type wbConfig struct {
	BaseURL  string
	ClientID string
	Secret   string
	Client   *http.Client
}

func loadWBConfig() wbConfig {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("WORKBENCH_BASE_URL")), "/")
	if base == "" {
		base = "http://127.0.0.1:7720"
	}
	return wbConfig{
		BaseURL:  base,
		ClientID: strings.TrimSpace(os.Getenv("WORKBENCH_SERVICE_CLIENT")),
		Secret:   strings.TrimSpace(os.Getenv("WORKBENCH_SERVICE_SECRET")),
		Client:   &http.Client{Timeout: 15 * time.Second},
	}
}

func (c wbConfig) Ready() bool { return c.BaseURL != "" && c.ClientID != "" && c.Secret != "" }

type wbSession struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
	User         Object
	// Space 是这次登录/刷新落点的空间（工作台响应的 current_space）。
	// 它随会话一起写进 ql_sessions —— 本地空间的唯一落点就是那里。
	Space spaceRef
}

// loginArgs 是工作台服务登录入参：密码登录带 captcha，邮箱验证码登录带 code。
type loginArgs struct {
	Email       string
	Password    string
	Code        string
	CaptchaID   string
	CaptchaCode string
}

// login signs in through the workbench service entry.
// 密码登录：工作台要求人机验证（与网页端同一口径）。
// 邮箱验证码登录：发码时已过闸，这里只传 email + code。
// 空间落点由工作台按 t_space_membership 决定，不再传 login_mode。
func (c wbConfig) login(ctx context.Context, args loginArgs) (wbSession, error) {
	body := Object{"email": args.Email, "service_code": "qingliu"}
	if args.Code != "" {
		body["code"] = args.Code
	} else {
		body["password"] = args.Password
		if args.CaptchaID != "" {
			body["captcha_id"] = args.CaptchaID
		}
		if args.CaptchaCode != "" {
			body["captcha_code"] = args.CaptchaCode
		}
	}
	status, data, err := c.do(ctx, http.MethodPost, "/api/v1/service/auth/login", body, "")
	if err != nil {
		return wbSession{}, err
	}
	if status != http.StatusOK {
		return wbSession{}, errors.New(wbMessage(data, "Incorrect account or password"))
	}
	return parseWBSession(data)
}

// register signs a new personal identity up on the workbench with the shared
// invite code. The service secret stays server-side.
func (c wbConfig) register(ctx context.Context, body Object) (wbSession, error) {
	status, data, err := c.do(ctx, http.MethodPost, "/api/v1/service/auth/register", body, "")
	if err != nil {
		return wbSession{}, err
	}
	if status != http.StatusCreated && status != http.StatusOK {
		return wbSession{}, errors.New(wbMessage(data, "注册失败"))
	}
	return parseWBSession(data)
}

// verifyCode proxies one-time-code issuance (registration / reset) so the
// browser never talks to the workbench directly.
func (c wbConfig) verifyCode(ctx context.Context, body Object) (int, Object, error) {
	return c.do(ctx, http.MethodPost, "/api/v1/auth/verification-codes", body, "")
}

// resetPassword proxies public password reset (email OTP + new password).
func (c wbConfig) resetPassword(ctx context.Context, body Object) (int, Object, error) {
	return c.do(ctx, http.MethodPost, "/api/v1/auth/reset-password", body, "")
}

// captcha proxies the workbench captcha challenge used before issuing codes.
func (c wbConfig) captcha(ctx context.Context, kind string) (int, Object, error) {
	path := "/api/v1/auth/captcha"
	if kind != "" {
		path += "?type=" + kind
	}
	return c.do(ctx, http.MethodGet, path, nil, "")
}

func (c wbConfig) refresh(ctx context.Context, refreshToken string) (wbSession, error) {
	status, data, err := c.do(ctx, http.MethodPost, "/api/v1/auth/refresh", Object{"refresh_token": refreshToken}, "")
	if err != nil {
		return wbSession{}, err
	}
	if status != http.StatusOK {
		// Keep the same user-facing phrase as a missing token so the recharge
		// page / topbar do not invent a second "session died" wording.
		return wbSession{}, errors.New("Please sign in to the workbench again")
	}
	return parseWBSession(data)
}

// serviceRequest 用服务凭证调用工作台（不带用户令牌），用于读取运营配置
// 与以服务身份记账这类不归属于某个用户会话的调用。
func (c wbConfig) serviceRequest(ctx context.Context, method, path string, body any) (int, Object, error) {
	return c.do(ctx, method, path, body, "")
}

func (c wbConfig) do(ctx context.Context, method, path string, body any, token string) (int, Object, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reader)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	// 所有 /service/ 路径都是服务间调用：带服务凭证，不带用户令牌。
	// 之前只对登录设置凭证，导致计费/计价这类服务接口一律 403。
	if strings.HasPrefix(path, "/api/v1/service/") {
		req.Header.Set("X-Service-Client", c.ClientID)
		req.Header.Set("X-Service-Secret", c.Secret)
	}
	resp, err := c.Client.Do(req)
	if err != nil {
		return 0, nil, errors.New("Workbench temporarily unavailable. Please retry later.")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	var data Object
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &data)
	}
	if data == nil {
		data = Object{}
	}
	return resp.StatusCode, data, nil
}

func parseWBSession(data Object) (wbSession, error) {
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	access, refresh := str(payload, "access_token"), str(payload, "refresh_token")
	if access == "" || refresh == "" {
		return wbSession{}, errors.New("工作台登录返回不完整")
	}
	expires := time.Now().Add(time.Hour)
	if raw := str(payload, "expires_at"); raw != "" {
		if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
			expires = parsed
		}
	}
	// ServiceLoginResult 带嵌套 user；普通 LoginResult/RefreshResult 是扁平的
	//（顶层 user_id / service_role）。只读 user.* 会在 refresh 路径把
	// workbench_user_id 写成 0，撞脏行后落库 panic、新 token 丢失（2026-11-12）。
	user := sub(payload, "user")
	if user == nil {
		user = Object{}
	}
	if integer(user["user_id"]) == 0 {
		if id := integer(payload["user_id"]); id > 0 {
			user["user_id"] = id
		}
	}
	if str(user, "service_role") == "" {
		if role := str(payload, "service_role"); role != "" {
			user["service_role"] = role
		}
	}
	if str(user, "email") == "" {
		if email := str(payload, "email"); email != "" {
			user["email"] = email
		}
	}
	if str(user, "display_name") == "" {
		if name := str(payload, "display_name"); name != "" {
			user["display_name"] = name
		}
	}
	return wbSession{
		AccessToken: access, RefreshToken: refresh, ExpiresAt: expires,
		User: user, Space: parseSpaceRef(payload, user),
	}, nil
}

// parseSpaceRef 从工作台响应里读这次会话的空间。
//
// 唯一权威字段是顶层的 current_space（工作台契约：{kind,id}）。它是**当前
// 空间**，而 user.tenant_id 是账号的主身份租户 —— 两者在多空间账号上不是
// 一回事，用后者决定归属会把「切到 A 企业」的会话落进 B 企业的资料里。
// 因此只在响应里完全没有 current_space 时，才退回 user 上的 space_kind/space_id
// （老版本工作台）；user.tenant_id 一律不读。
func parseSpaceRef(payload, user Object) spaceRef {
	if current := sub(payload, "current_space"); current != nil {
		return spaceRef{Kind: normalizeSpaceKind(str(current, "kind")), ID: integer(current["id"])}
	}
	if user != nil && str(user, "space_kind") != "" {
		return spaceRef{Kind: normalizeSpaceKind(str(user, "space_kind")), ID: integer(user["space_id"])}
	}
	// 两边都没有：落到个人空间。个人空间只看得见自己创建的资料，
	// 这是最小权限的兜底，也不会把一个账号错放进某个企业。
	return spaceRef{Kind: spacePersonal}
}

func sub(o Object, key string) Object {
	if o == nil {
		return nil
	}
	value, ok := o[key].(map[string]any)
	if !ok || value == nil {
		return nil
	}
	return value
}

func bytesOf(value any) []byte {
	switch raw := value.(type) {
	case []byte:
		return raw
	case string:
		// Store.query normalizes every []byte column to string; VARBINARY
		// token columns therefore arrive here as string, not []byte.
		return []byte(raw)
	default:
		return nil
	}
}

func wbPayload(data Object) any {
	if data == nil {
		return nil
	}
	if value, ok := data["data"]; ok {
		return value
	}
	return data
}

func wbMessage(data Object, fallback string) string {
	if data == nil {
		return fallback
	}
	if message := str(data, "message"); message != "" {
		return message
	}
	if errObj := sub(data, "error"); errObj != nil {
		if message := str(errObj, "message"); message != "" {
			return message
		}
	}
	return fallback
}

func (s *Store) seal(raw []byte) []byte {
	nonce := make([]byte, s.vault.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil
	}
	return append(nonce, s.vault.Seal(nil, nonce, raw, nil)...)
}

func (s *Store) unseal(raw []byte) []byte {
	if len(raw) <= s.vault.NonceSize() {
		return nil
	}
	nonce := raw[:s.vault.NonceSize()]
	plain, err := s.vault.Open(nil, nonce, raw[s.vault.NonceSize():], nil)
	if err != nil {
		return nil
	}
	return plain
}

// wbSaveLogin 落库账号与令牌，并返回这次登录所在的空间。
//
// 空间来自工作台登录响应的 current_space（见 parseWBSession），**不读**
// user["tenant_id"]：那个字段是账号的主身份租户，而这里要的是「这次会话落在
// 哪个空间」。返回值由调用方交给 newSession 写进 ql_sessions —— 会话是本地
// 空间的唯一落点（ql_users 上已经没有空间列，见 migrations/005）。
func (a *App) wbSaveLogin(userID string, session wbSession) spaceRef {
	user := session.User
	email := strings.TrimSpace(str(user, "email"))
	display := strings.TrimSpace(str(user, "display_name"))
	serviceRole := strings.TrimSpace(str(user, "service_role"))
	wbID := integer(user["user_id"])
	existing := a.wbAccount(userID)
	// refresh 可能只带回 token + user_id：缺资料时保留库里已有绑定，
	// 绝不能把 workbench_user_id 写成 0（会撞脏行 Duplicate entry '0'）。
	if wbID <= 0 && existing != nil {
		wbID = integer(existing["workbench_user_id"])
	}
	if email == "" && existing != nil {
		email = str(existing, "email")
	}
	if display == "" && existing != nil {
		display = str(existing, "display_name")
	}
	if serviceRole == "" && existing != nil {
		serviceRole = str(existing, "service_role")
	}
	// 权限快照（见 server/permissions.go）：优先用工作台真的返回的权限码，
	// 没有时按服务角色映射。存下来之后，判定不再依赖「三条字符串」。
	codes := loginPermissions(serviceRole, strList(user["permissions"]))
	permissionsJSON := js(codes)
	if (codes == nil || len(codes) == 0) && existing != nil {
		if raw := strings.TrimSpace(str(existing, "permissions")); raw != "" && raw != "null" {
			permissionsJSON = raw
		}
	}
	if wbID <= 0 {
		// 没有可落的绑定 id：只更令牌，避免 INSERT/UPDATE 写出 0。
		if existing == nil {
			return session.Space
		}
		a.s.exec(`UPDATE ql_workbench_accounts SET access_token=?,refresh_token=?,token_expires=? WHERE user_id=?`,
			a.s.seal([]byte(session.AccessToken)), a.s.seal([]byte(session.RefreshToken)), session.ExpiresAt.Unix(), userID)
		return session.Space
	}
	a.s.exec(`INSERT INTO ql_workbench_accounts
 (user_id,workbench_user_id,email,display_name,service_role,access_token,refresh_token,token_expires,permissions)
 VALUES(?,?,?,?,?,?,?,?,?)
 ON DUPLICATE KEY UPDATE
 workbench_user_id=IF(VALUES(workbench_user_id)>0, VALUES(workbench_user_id), workbench_user_id),
 email=IF(VALUES(email)<>'', VALUES(email), email),
 display_name=IF(VALUES(display_name)<>'', VALUES(display_name), display_name),
 service_role=IF(VALUES(service_role)<>'', VALUES(service_role), service_role),
 access_token=VALUES(access_token),
 refresh_token=VALUES(refresh_token),
 token_expires=VALUES(token_expires),
 permissions=IF(VALUES(permissions) IS NULL OR VALUES(permissions) IN ('','null','[]'), permissions, VALUES(permissions))`,
		userID, wbID, email, display, serviceRole, a.s.seal([]byte(session.AccessToken)), a.s.seal([]byte(session.RefreshToken)), session.ExpiresAt.Unix(), permissionsJSON)
	return session.Space
}

// wbUpsertLocalUser reuses an existing ql_users row with the same email so
// existing grants and audit history survive the move to workbench accounts.
//
// 这里**不**再决定「他属于哪个团队」：ql_users 上已经没有团队归属与团队角色两列
// （见 migrations/005）。空间随会话走（wbSession.Space），因此同一个人切到别
// 的空间不需要改这一行 —— 账号是同一个账号。
func (a *App) wbUpsertLocalUser(session wbSession) string {
	user := session.User
	email := strings.TrimSpace(str(user, "email"))
	if email == "" {
		email = "workbench-" + itoa(integer(user["user_id"]))
	}
	display := strings.TrimSpace(str(user, "display_name"))
	if display == "" {
		display = email
	}
	// 与服务角色同名落库：role 列已降级为「默认值/显示标签」（见 localRole）。
	// 原先是「三档之外一律 sales」，让只读成员拿到了写权限；这里保持原始
	// 服务角色，判定交给权限快照。
	role := localRole(str(user, "service_role"))
	if existing := a.s.one("SELECT id FROM ql_users WHERE username=?", email); existing != nil {
		uid := str(existing, "id")
		a.s.exec("UPDATE ql_users SET display=?,role=?,active=TRUE WHERE id=?", display, role, uid)
		return uid
	}
	uid := id()
	random, _ := bcrypt.GenerateFromPassword([]byte(id()+id()), bcrypt.DefaultCost)
	a.s.exec("INSERT INTO ql_users(id,username,display,role,password) VALUES(?,?,?,?,?)", uid, email, display, role, string(random))
	return uid
}

func (a *App) wbAccount(userID string) Object {
	return a.s.one("SELECT * FROM ql_workbench_accounts WHERE user_id=?", userID)
}

// newSession 建一个本会话，并记下它落在哪个空间。
//
// 空间由调用方给：工作台登录时是响应里的 current_space（wbSaveLogin 的返回值），
// 本地应急登录时是个人空间 —— 账号上已经没有「所属团队」可读（见 migrations/005）。
// 之后由 POST /api/switch-space 改写本行。
// 显式列名而不是 VALUES(?..)：设了默认值的列不该靠表顺序撞运气。
func (a *App) newSession(q *request, userID string, space spaceRef) {
	a.s.exec("DELETE FROM ql_sessions WHERE expires<?", time.Now().Unix())
	token, csrf := id()+id(), id()+id()
	a.s.exec("INSERT INTO ql_sessions(token,user_id,csrf,expires,space_kind,space_id) VALUES(?,?,?,?,?,?)", hash([]byte(token)), userID, csrf, time.Now().Add(8*time.Hour).Unix(), space.Kind, space.ID)
	http.SetCookie(q.w, &http.Cookie{Name: "ql_session", Value: token, Path: "/", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode, MaxAge: 28800})
	a.s.event(space, userID, "", "login", space.Kind+":"+itoa(space.ID))
}

// wbAccessToken returns a usable workbench access token for userID.
//
// When the stored access token is near expiry it refreshes first. Callers must
// surface the returned error as-is: a down workbench is "工作台暂时不可用…",
// while a dead refresh token is "请重新登录工作台账号". Collapsing every failure
// into the re-login message is what made local outages look like auth bugs.
func (a *App) wbAccessToken(userID string) (string, error) {
	account := a.wbAccount(userID)
	if account == nil {
		return "", errors.New("Please sign in to the workbench again")
	}
	expires := integer(account["token_expires"])
	if expires > 0 && time.Now().Unix() > expires-60 {
		return a.wbRefresh(userID)
	}
	token := string(a.s.unseal(bytesOf(account["access_token"])))
	if token == "" {
		return "", errors.New("Please sign in to the workbench again")
	}
	return token, nil
}

// wbRefreshWaitTimeout 是「同 user 等同伴刷新结果」的上限。领飞者的上游
// 调用本身有 15s 客户端超时，这里再留一倍余量；超时就直接失败退出，
// 绝不把一个准入槽（见 pool.go 的 proxy 池）无限期挂在 gate 上。
const wbRefreshWaitTimeout = 30 * time.Second

// wbRefresh 刷新工作台 access token，并按 userID 做单飞：同一时刻只允许
// 一次上游 /auth/refresh。工作台 refresh token 轮换后复用会吊销整个
// family（见后端 auth.Refresh → ErrRefreshTokenReused），并发刷新等于自踢。
func (a *App) wbRefresh(userID string) (string, error) {
	if a == nil {
		return "", errors.New("Please sign in to the workbench again")
	}
	a.refreshMu.Lock()
	if a.refreshGates == nil {
		a.refreshGates = map[string]*wbRefreshGate{}
	}
	if gate, ok := a.refreshGates[userID]; ok {
		a.refreshMu.Unlock()
		// 等同伴必须有兜底：领飞者一旦 panic 或上游卡住，等待方不能永久
		// 占着准入槽 —— proxy 池被长期占用同样会拖慢全站（见 2026-11-12 生产故障）。
		select {
		case <-gate.done:
			return gate.token, gate.err
		case <-time.After(wbRefreshWaitTimeout):
			return "", errors.New("Workbench is temporarily unavailable. Try again later.")
		}
	}
	gate := &wbRefreshGate{done: make(chan struct{})}
	a.refreshGates[userID] = gate
	a.refreshMu.Unlock()

	// 收尾无条件执行：成功、失败、panic 都必须销号并 close(gate.done)。
	// 少关一次，该用户后续每个请求都会卡在 <-gate.done，4 个并发槽被这样
	// 占满后所有接口（含 /health）全部 503，只能重启进程恢复。
	var token string
	var err error
	defer func() {
		p := recover()
		if p != nil {
			token, err = "", errors.New("Workbench is temporarily unavailable. Try again later.")
		}
		a.refreshMu.Lock()
		gate.token, gate.err = token, err
		delete(a.refreshGates, userID)
		a.refreshMu.Unlock()
		close(gate.done)
		if p != nil {
			panic(p)
		}
	}()

	token, err = a.wbRefreshOnce(userID)
	if err != nil {
		// 瞬时失败时：可能同伴已刷成功并写库，优先复用仍有效的 access。
		if fresh, ok := a.wbFreshAccess(userID); ok {
			token, err = fresh, nil
		}
	}
	return token, err
}

func (a *App) wbRefreshOnce(userID string) (string, error) {
	account := a.wbAccount(userID)
	if account == nil {
		return "", errors.New("Please sign in to the workbench again")
	}
	// 进闸后再次检查：同伴可能刚刷完，不必再拿旧 refresh 去撞轮换。
	expires := integer(account["token_expires"])
	if expires > time.Now().Unix()+60 {
		token := string(a.s.unseal(bytesOf(account["access_token"])))
		if token != "" {
			return token, nil
		}
	}
	rawRefresh := string(a.s.unseal(bytesOf(account["refresh_token"])))
	if rawRefresh == "" {
		return "", errors.New("Please sign in to the workbench again")
	}
	session, err := a.wb.refresh(context.Background(), rawRefresh)
	if err != nil {
		return "", err
	}
	a.wbSaveLogin(userID, session)
	return session.AccessToken, nil
}

// wbFreshAccess 读库里仍可用的 access token（距过期 >60s）。
func (a *App) wbFreshAccess(userID string) (string, bool) {
	account := a.wbAccount(userID)
	if account == nil {
		return "", false
	}
	expires := integer(account["token_expires"])
	if expires <= time.Now().Unix()+60 {
		return "", false
	}
	token := string(a.s.unseal(bytesOf(account["access_token"])))
	if token == "" {
		return "", false
	}
	return token, true
}

// wbRequest calls the workbench on behalf of a local session. A 401 triggers
// one refresh-and-retry so an eight-hour qingliu session does not die when the
// short workbench access token rotates.
func (a *App) wbUploadDocument(ctx context.Context, userID, path, name string) (int64, error) {
	token, err := a.wbAccessToken(userID)
	if err != nil {
		return 0, err
	}
	// 磁盘上的 uploads 是 QLGO1 加密件；发给工作台必须先解密成真实 PDF，
	// 否则 aidoc 会把密文当 PDF 解析并报 PDF_UNREADABLE。
	plain, err := a.s.read(path)
	if err != nil {
		return 0, err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		return 0, err
	}
	if _, err := part.Write(plain); err != nil {
		return 0, err
	}
	if err := writer.Close(); err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.wb.BaseURL+"/api/v1/ai/documents", &body)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := a.wb.Client.Do(req)
	if err != nil {
		return 0, errors.New("Workbench temporarily unavailable. Please retry later.")
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var envelope Object
	_ = json.Unmarshal(raw, &envelope)
	payload := sub(envelope, "data")
	if resp.StatusCode != http.StatusCreated || payload == nil {
		return 0, errors.New(wbMessage(envelope, "文档上传失败"))
	}
	id := integer(payload["document_id"])
	if id == 0 {
		return 0, errors.New("文档上传返回不完整")
	}
	return id, nil
}

func (a *App) wbRequest(ctx context.Context, userID, method, path string, body any) (int, Object, error) {
	if !a.wb.Ready() {
		return 0, nil, errors.New("Workbench is not connected")
	}
	token, err := a.wbAccessToken(userID)
	if err != nil {
		return http.StatusUnauthorized, nil, err
	}
	status, data, err := a.wb.do(ctx, method, path, body, token)
	if err != nil {
		return status, data, err
	}
	if status == http.StatusUnauthorized {
		refreshed, refreshErr := a.wbRefresh(userID)
		if refreshErr != nil {
			return http.StatusUnauthorized, nil, refreshErr
		}
		return a.wb.do(ctx, method, path, body, refreshed)
	}
	return status, data, nil
}

func itoa(value int64) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var buf [20]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// spaceCaption 是空间显示所需的两件事：名字与角色标签。
type spaceCaption struct {
	Name string
	Role string
}

// spaceLabel 返回当前空间的显示名与角色标签。
//
// 名字的**唯一来源**是工作台的 /api/v1/me/spaces：团队名在 t_tenant，角色标签
// （团队管理员/成员）是 t_space_membership 的 role_label。清流不自己拼
// 「企业 #id」，也不从 ql_users 猜角色 —— 那会让同一个空间在两个系统里有两个
// 名字、同一个人有两个角色。结果按 (kind:id) 缓存：/api/me 调用频繁，
// 而空间名一天也变不了几次。
func (a *App) spaceLabel(ctx context.Context, userID string, target spaceRef) (string, string) {
	if target.Kind == spacePersonal {
		return spaceFallbackName(target), ""
	}
	key := target.Kind + ":" + itoa(target.ID)
	a.spaceMu.Lock()
	cached, ok := a.spaceNames[key]
	a.spaceMu.Unlock()
	if ok && cached.Name != "" {
		return cached.Name, cached.Role
	}

	status, data, err := a.wbRequest(ctx, userID, http.MethodGet, "/api/v1/me/spaces", nil)
	if err != nil || status != http.StatusOK {
		return spaceFallbackName(target), ""
	}
	for _, item := range spaceItems(data) {
		if normalizeSpaceKind(str(item, "kind")) != target.Kind || integer(item["id"]) != target.ID {
			continue
		}
		label := spaceCaption{Name: strings.TrimSpace(str(item, "name")), Role: strings.TrimSpace(str(item, "role_label"))}
		if label.Name == "" {
			label.Name = spaceFallbackName(target)
		}
		a.spaceMu.Lock()
		if a.spaceNames == nil {
			a.spaceNames = map[string]spaceCaption{}
		}
		a.spaceNames[key] = label
		a.spaceMu.Unlock()
		return label.Name, label.Role
	}
	return spaceFallbackName(target), ""
}

// localRole 把工作台的服务角色收敛到清流的**粗粒度** role 列。
//
// 它现在只是一个「默认值 / 显示用标签」：真正的判定读权限快照
// （见 server/permissions.go）。认不出的角色落到 readonly 而不是 sales
// —— 「三档之外一律 sales」正是「只读成员能改资料」这个缺陷的来源。
func localRole(serviceRole string) string {
	switch serviceRole {
	case "admin", "sales", "reviewer":
		return serviceRole
	case "enterprise_member_readonly":
		return "reviewer"
	case "":
		return "readonly"
	default:
		return "readonly"
	}
}
