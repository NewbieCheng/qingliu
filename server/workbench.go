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
}

// login signs in through the workbench service entry. captchaID/captchaCode are
// the human challenge solved in the qingliu login page; the workbench requires
// it for password logins exactly like its own web login.
func (c wbConfig) login(ctx context.Context, email, password string, mode int, captchaID, captchaCode string) (wbSession, error) {
	body := Object{"email": email, "password": password, "service_code": "qingliu", "login_mode": loginModeName(mode)}
	if captchaID != "" {
		body["captcha_id"] = captchaID
	}
	if captchaCode != "" {
		body["captcha_code"] = captchaCode
	}
	status, data, err := c.do(ctx, http.MethodPost, "/api/v1/service/auth/login", body, "")
	if err != nil {
		return wbSession{}, err
	}
	if status != http.StatusOK {
		return wbSession{}, errors.New(wbMessage(data, "账号或密码不正确"))
	}
	return parseWBSession(data)
}

// loginModeName maps the qingliu login tab to the workbench login mode.
// 1 = personal, 2 = enterprise (teams/companies provisioned in the workbench).
func loginModeName(mode int) string {
	if mode == 2 {
		return "enterprise"
	}
	return "personal"
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
		return wbSession{}, errors.New("登录状态已过期，请重新登录")
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
	if path == "/api/v1/service/auth/login" {
		req.Header.Set("X-Service-Client", c.ClientID)
		req.Header.Set("X-Service-Secret", c.Secret)
	}
	resp, err := c.Client.Do(req)
	if err != nil {
		return 0, nil, errors.New("工作台暂时不可用，请稍后重试")
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
	user := sub(payload, "user")
	// 租户决定资料归属：顶层与 user 里都可能出现，取到哪个用哪个。
	if user != nil && integer(user["tenant_id"]) == 0 {
		if tenant := integer(payload["tenant_id"]); tenant > 0 {
			user["tenant_id"] = tenant
		}
	}
	return wbSession{
		AccessToken: access, RefreshToken: refresh, ExpiresAt: expires,
		User: user,
	}, nil
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

func (a *App) wbSaveLogin(userID string, session wbSession) {
	user := session.User
	email := str(user, "email")
	display := str(user, "display_name")
	role := str(user, "service_role")
	if role != "admin" && role != "sales" && role != "reviewer" {
		role = "sales"
	}
	wbID := integer(user["user_id"])
	a.s.exec(`INSERT INTO ql_workbench_accounts
 (user_id,workbench_user_id,email,display_name,service_role,access_token,refresh_token,token_expires)
 VALUES(?,?,?,?,?,?,?,?)
 ON DUPLICATE KEY UPDATE workbench_user_id=VALUES(workbench_user_id),email=VALUES(email),
 display_name=VALUES(display_name),service_role=VALUES(service_role),access_token=VALUES(access_token),
 refresh_token=VALUES(refresh_token),token_expires=VALUES(token_expires)`,
		userID, wbID, email, display, role, a.s.seal([]byte(session.AccessToken)), a.s.seal([]byte(session.RefreshToken)), session.ExpiresAt.Unix())
}

// wbUpsertLocalUser reuses an existing ql_users row with the same email so
// existing grants and audit history survive the move to workbench accounts.
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
	role := str(user, "service_role")
	if role != "admin" && role != "sales" && role != "reviewer" {
		role = "sales"
	}
	tenant := integer(user["tenant_id"])
	// 默认团队「今天不加班」承接既有管理员：工作台上还没有租户的管理员账号
	// 首次登录清流时落到 team 1，避免管理员的资料散落在个人空间。
	if tenant == 0 && role == "admin" && defaultTeamTenantID > 0 {
		tenant = defaultTeamTenantID
	}
	tenantRole := ""
	if tenant > 0 {
		tenantRole = str(user, "service_role")
		if tenantRole != "admin" {
			tenantRole = "member"
		}
	}
	if existing := a.s.one("SELECT id FROM ql_users WHERE username=?", email); existing != nil {
		uid := str(existing, "id")
		a.s.exec("UPDATE ql_users SET display=?,role=?,tenant_id=?,tenant_role=?,active=TRUE WHERE id=?", display, role, tenant, tenantRole, uid)
		return uid
	}
	uid := id()
	random, _ := bcrypt.GenerateFromPassword([]byte(id()+id()), bcrypt.DefaultCost)
	a.s.exec("INSERT INTO ql_users(id,username,display,role,password,tenant_id,tenant_role) VALUES(?,?,?,?,?,?,?)", uid, email, display, role, string(random), tenant, tenantRole)
	return uid
}

func (a *App) wbAccount(userID string) Object {
	return a.s.one("SELECT * FROM ql_workbench_accounts WHERE user_id=?", userID)
}

func (a *App) newSession(q *request, userID string) {
	a.s.exec("DELETE FROM ql_sessions WHERE expires<?", time.Now().Unix())
	token, csrf := id()+id(), id()+id()
	a.s.exec("INSERT INTO ql_sessions VALUES(?,?,?,?)", hash([]byte(token)), userID, csrf, time.Now().Add(8*time.Hour).Unix())
	http.SetCookie(q.w, &http.Cookie{Name: "ql_session", Value: token, Path: "/", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode, MaxAge: 28800})
	a.s.event(userID, "", "login", "")
}

func (a *App) wbAccessToken(userID string) string {
	account := a.wbAccount(userID)
	if account == nil {
		return ""
	}
	expires := integer(account["token_expires"])
	if expires > 0 && time.Now().Unix() > expires-60 {
		if refreshed, ok := a.wbRefresh(userID); ok {
			return refreshed
		}
		return ""
	}
	return string(a.s.unseal(bytesOf(account["access_token"])))
}

func (a *App) wbRefresh(userID string) (string, bool) {
	account := a.wbAccount(userID)
	if account == nil {
		return "", false
	}
	rawRefresh := string(a.s.unseal(bytesOf(account["refresh_token"])))
	if rawRefresh == "" {
		return "", false
	}
	session, err := a.wb.refresh(context.Background(), rawRefresh)
	if err != nil {
		return "", false
	}
	a.wbSaveLogin(userID, session)
	return session.AccessToken, true
}

// wbRequest calls the workbench on behalf of a local session. A 401 triggers
// one refresh-and-retry so an eight-hour qingliu session does not die when the
// short workbench access token rotates.
func (a *App) wbUploadDocument(ctx context.Context, userID, path, name string) (int64, error) {
	token := a.wbAccessToken(userID)
	if token == "" {
		return 0, errors.New("请重新登录工作台账号")
	}
	file, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		return 0, err
	}
	if _, err := io.Copy(part, file); err != nil {
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
		return 0, errors.New("工作台暂时不可用，请稍后重试")
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
		return 0, nil, errors.New("尚未接入工作台")
	}
	token := a.wbAccessToken(userID)
	if token == "" {
		return http.StatusUnauthorized, nil, errors.New("请重新登录工作台账号")
	}
	status, data, err := a.wb.do(ctx, method, path, body, token)
	if err != nil {
		return status, data, err
	}
	if status == http.StatusUnauthorized {
		if refreshed, ok := a.wbRefresh(userID); ok {
			return a.wb.do(ctx, method, path, body, refreshed)
		}
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
