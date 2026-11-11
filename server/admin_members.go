package main

import (
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// listWorkbenchMembers 以工作台企业成员为准返回清流管理页/授权下拉。
//
// 账号真相在工作台；清流只同步影子行（ql_users）与绑定（ql_workbench_accounts），
// 并在返回里带 workbench_user_id，供客户授权双写。
func (a *App) listWorkbenchMembers(q *request) []Object {
	q.requireTeamSpace()
	if !a.wb.Ready() {
		bad(503, "Workbench is not connected")
	}
	status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodGet, "/api/v1/tenant/members?page=1&page_size=100", nil)
	if err != nil {
		bad(503, err.Error())
	}
	if status != http.StatusOK {
		bad(status, wbMessage(data, "成员列表加载失败"))
	}
	selfID := str(q.user, "id")
	selfWB := integer(q.user["workbench_user_id"])
	items := memberItems(data)
	out := make([]Object, 0, len(items))
	for _, item := range items {
		member := a.syncLocalMember(item)
		// 自己账号不进管理列表：不可停用/删除自己，界面也不展示。
		if str(member, "id") == selfID || (selfWB > 0 && integer(member["workbench_user_id"]) == selfWB) {
			continue
		}
		out = append(out, member)
	}
	return out
}

// createWorkbenchMember 在工作台开户，再同步一份本地影子行（不是第二套账号库）。
//
// 工作台 Role 只有成员(1)/企业管理员(2)；清流的 sales/reviewer 写在 service_role
// 与本地 role 投影里，登录后由权限快照覆盖。
func (a *App) createWorkbenchMember(q *request, username, display, password, role string) {
	q.requireTeamSpace()
	if !a.wb.Ready() {
		bad(503, "Workbench is not connected")
	}
	username = strings.TrimSpace(username)
	display = strings.TrimSpace(display)
	role = strings.TrimSpace(role)
	if username == "" || len(username) > 60 || len(display) > 120 || len(password) < 10 || len(password) > 72 {
		bad(400, "Account required; password 10–72 bytes; role must be valid")
	}
	if role != "sales" && role != "reviewer" && role != "admin" {
		bad(400, "Account required; password 10–72 bytes; role must be valid")
	}
	if display == "" {
		display = username
	}
	wbRole := uint8(1)
	if role == "admin" {
		wbRole = 2
	}
	// 同一套账号：企业角色走 role，清流细角色走 service_role；工作台管理后台
	// 开户与这里落的是同一行 t_user + t_user_service。
	status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodPost, "/api/v1/tenant/members/open", Object{
		"email": username, "display_name": display, "password": password, "role": wbRole, "service_role": role,
	})
	if err != nil {
		bad(503, err.Error())
	}
	if status < 200 || status >= 300 {
		bad(status, wbMessage(data, "创建成员失败"))
	}
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	if str(payload, "service_role") == "" {
		payload["service_role"] = role
	}
	if str(payload, "email") == "" {
		payload["email"] = username
	}
	if str(payload, "display_name") == "" {
		payload["display_name"] = display
	}
	a.syncLocalMember(payload)
}

// removeWorkbenchMember 移出当前企业：工作台收回团队空间，个人账号保留。
// 须先用操作者密码二次确认（工作台 /auth/verify-password，不改密、不撤令牌）。
func (a *App) removeWorkbenchMember(q *request, localUserID, password string) {
	q.requireTeamSpace()
	if !a.wb.Ready() {
		bad(503, "Workbench is not connected")
	}
	password = strings.TrimSpace(password)
	require(password != "", "请输入当前登录密码以确认删除")
	require(localUserID != str(q.user, "id"), "Cannot delete the current account")
	account := a.wbAccount(localUserID)
	require(account != nil && integer(account["workbench_user_id"]) > 0, "User not found or not linked to workbench")
	wbID := integer(account["workbench_user_id"])

	status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodPost,
		"/api/v1/auth/verify-password", Object{"password": password})
	if err != nil {
		bad(503, err.Error())
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		bad(403, "密码不正确")
	}
	if status < 200 || status >= 300 {
		bad(status, wbMessage(data, "密码校验失败"))
	}

	status, data, err = a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodDelete,
		"/api/v1/tenant/members/"+itoa(wbID), nil)
	if err != nil {
		bad(503, err.Error())
	}
	if status < 200 || status >= 300 {
		bad(status, wbMessage(data, "移出企业失败"))
	}

	// 清流侧：清客户授权与会话；影子行保留（审计/任务外键），列表以工作台为准不再出现。
	a.s.exec("DELETE FROM ql_grants WHERE user_id=? OR workbench_user_id=?", localUserID, wbID)
	a.s.exec("DELETE FROM ql_sessions WHERE user_id=?", localUserID)
}

// toggleWorkbenchMember 启停以工作台账号状态为准，再镜像到本地 active。
func (a *App) toggleWorkbenchMember(q *request, localUserID string) {
	q.requireTeamSpace()
	if !a.wb.Ready() {
		bad(503, "Workbench is not connected")
	}
	require(localUserID != str(q.user, "id"), "Cannot disable the current account")
	account := a.wbAccount(localUserID)
	require(account != nil && integer(account["workbench_user_id"]) > 0, "User not found or not linked to workbench")
	local := a.s.one("SELECT id,active FROM ql_users WHERE id=?", localUserID)
	require(local != nil, "User not found")
	nextStatus := int64(1) // UserStatusActive
	if yesActive(local["active"]) {
		nextStatus = 2 // UserStatusFrozen
	}
	wbID := integer(account["workbench_user_id"])
	status, data, err := a.wbRequest(q.r.Context(), str(q.user, "id"), http.MethodPut,
		"/api/v1/tenant/members/"+itoa(wbID)+"/status", Object{"status": nextStatus})
	if err != nil {
		bad(503, err.Error())
	}
	if status < 200 || status >= 300 {
		bad(status, wbMessage(data, "启停成员失败"))
	}
	active := nextStatus == 1
	a.s.exec("UPDATE ql_users SET active=? WHERE id=?", active, localUserID)
	if !active {
		a.s.exec("DELETE FROM ql_sessions WHERE user_id=?", localUserID)
	}
}

// syncLocalMember 把工作台成员行落到 ql_users + ql_workbench_accounts（不覆盖已有令牌）。
func (a *App) syncLocalMember(item Object) Object {
	email := strings.TrimSpace(str(item, "email"))
	wbID := integer(item["user_id"])
	if email == "" || wbID <= 0 {
		bad(502, "工作台成员数据不完整")
	}
	display := strings.TrimSpace(str(item, "display_name"))
	if display == "" {
		display = email
	}
	serviceRole := strings.TrimSpace(str(item, "service_role"))
	role := resolveSyncedLocalRole(serviceRole, integer(item["role"]), func() string {
		if linked := a.s.one("SELECT u.role FROM ql_workbench_accounts w JOIN ql_users u ON u.id=w.user_id WHERE w.workbench_user_id=?", wbID); linked != nil {
			return str(linked, "role")
		}
		if existing := a.s.one("SELECT role FROM ql_users WHERE username=?", email); existing != nil {
			return str(existing, "role")
		}
		return ""
	})
	active := integer(item["status"]) == 0 || integer(item["status"]) == 1

	var uid string
	if linked := a.s.one("SELECT user_id FROM ql_workbench_accounts WHERE workbench_user_id=?", wbID); linked != nil {
		uid = str(linked, "user_id")
		a.s.exec("UPDATE ql_users SET username=?,display=?,role=?,active=? WHERE id=?", email, display, role, active, uid)
	} else if existing := a.s.one("SELECT id FROM ql_users WHERE username=?", email); existing != nil {
		uid = str(existing, "id")
		a.s.exec("UPDATE ql_users SET display=?,role=?,active=? WHERE id=?", display, role, active, uid)
	} else {
		uid = id()
		random, _ := bcrypt.GenerateFromPassword([]byte(id()+id()), bcrypt.DefaultCost)
		a.s.exec("INSERT INTO ql_users(id,username,display,role,password,active) VALUES(?,?,?,?,?,?)",
			uid, email, display, role, string(random), active)
	}

	if account := a.wbAccount(uid); account == nil {
		a.s.exec(`INSERT INTO ql_workbench_accounts
 (user_id,workbench_user_id,email,display_name,service_role,access_token,refresh_token,token_expires,permissions)
 VALUES(?,?,?,?,?,NULL,NULL,0,?)`,
			uid, wbID, email, display, serviceRole, js(loginPermissions(serviceRole, nil)))
	} else {
		a.s.exec(`UPDATE ql_workbench_accounts SET workbench_user_id=?,email=?,display_name=?,service_role=? WHERE user_id=?`,
			wbID, email, display, serviceRole, uid)
	}
	return Object{
		"id": uid, "workbench_user_id": wbID,
		"username": email, "display": display, "role": role, "active": active,
	}
}

func memberItems(data Object) []Object {
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	raw, _ := payload["items"].([]any)
	out := make([]Object, 0, len(raw))
	for _, value := range raw {
		if item, ok := value.(map[string]any); ok {
			out = append(out, item)
		}
	}
	return out
}

// resolveSyncedLocalRole：工作台列表未必带回 t_user_service.service_role
// （Identity 读的是 t_user 投影）。有显式 service_role 用它；否则保留已有
// 本地细角色；全新成员按企业角色落到 admin/sales，避免整表变成 readonly。
func resolveSyncedLocalRole(serviceRole string, enterpriseRole int64, existingLocal func() string) string {
	if role := localRole(serviceRole); role != "readonly" {
		return role
	}
	if local := strings.TrimSpace(existingLocal()); local == "admin" || local == "sales" || local == "reviewer" {
		return local
	}
	if enterpriseRole >= 2 {
		return "admin"
	}
	return "sales"
}

func yesActive(v any) bool {
	switch n := v.(type) {
	case bool:
		return n
	case int64:
		return n != 0
	case int:
		return n != 0
	case float64:
		return n != 0
	case []byte:
		return string(n) == "1" || strings.EqualFold(string(n), "true")
	case string:
		return n == "1" || strings.EqualFold(n, "true")
	default:
		return integer(v) != 0
	}
}
