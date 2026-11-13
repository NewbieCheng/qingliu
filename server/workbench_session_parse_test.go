package main

import (
	"encoding/json"
	"testing"
	"time"
)

// 工作台契约：LoginResult / RefreshResult 是扁平的
// {user_id, access_token, refresh_token, expires_at, service_role, current_space…}。
// 只有 ServiceLoginResult 额外嵌套 user。

func flatRefreshEnvelope(userID int64) Object {
	raw, _ := json.Marshal(map[string]any{
		"data": map[string]any{
			"user_id":       userID,
			"access_token":  "access-new",
			"refresh_token": "refresh-new",
			"expires_at":    time.Now().UTC().Add(15 * time.Minute).Format(time.RFC3339),
			"service_code":  "qingliu",
			"service_role":  "sales",
			"current_space": map[string]any{"kind": "team", "id": 12},
		},
	})
	return obj(string(raw))
}

func serviceLoginEnvelope(userID int64) Object {
	raw, _ := json.Marshal(map[string]any{
		"data": map[string]any{
			"user_id":       userID,
			"access_token":  "access-login",
			"refresh_token": "refresh-login",
			"expires_at":    time.Now().UTC().Add(15 * time.Minute).Format(time.RFC3339),
			"service_code":  "qingliu",
			"service_role":  "sales",
			"current_space": map[string]any{"kind": "team", "id": 12},
			"user": map[string]any{
				"user_id":      userID,
				"email":        "qingliu-sales01@bujiaban.cn",
				"display_name": "清流业务员一",
				"service_role": "sales",
			},
		},
	})
	return obj(string(raw))
}

func identityFromSession(session wbSession) (wbID int64, email, display, serviceRole string) {
	user := session.User
	return integer(user["user_id"]), str(user, "email"), str(user, "display_name"), str(user, "service_role")
}

func TestParseWBSessionServiceLoginKeepsNestedUser(t *testing.T) {
	session, err := parseWBSession(serviceLoginEnvelope(33))
	if err != nil {
		t.Fatal(err)
	}
	wbID, email, display, role := identityFromSession(session)
	if wbID != 33 || email == "" || display == "" || role != "sales" {
		t.Fatalf("service login identity = id=%d email=%q display=%q role=%q", wbID, email, display, role)
	}
	if session.Space.Kind != spaceTeam || session.Space.ID != 12 {
		t.Fatalf("space = %+v", session.Space)
	}
}

func TestParseWBSessionFlatRefreshKeepsWorkbenchIdentity(t *testing.T) {
	session, err := parseWBSession(flatRefreshEnvelope(33))
	if err != nil {
		t.Fatal(err)
	}
	if session.AccessToken != "access-new" || session.RefreshToken != "refresh-new" {
		t.Fatalf("tokens not parsed: %+v", session)
	}
	if session.Space.Kind != spaceTeam || session.Space.ID != 12 {
		t.Fatalf("space should parse from top-level current_space: %+v", session.Space)
	}

	wbID, _, _, role := identityFromSession(session)
	if wbID != 33 {
		t.Fatalf("flat refresh must lift top-level user_id, got %d", wbID)
	}
	if role != "sales" {
		t.Fatalf("flat refresh must lift top-level service_role, got %q", role)
	}
}

func TestLocalizeWorkbenchReloginMessage(t *testing.T) {
	got := localizeStoredMessage(localeZH, "Please sign in to the workbench again")
	if got != "请重新登录工作台账号" {
		t.Fatalf("zh relogin = %q", got)
	}
	got = localizeStoredMessage(localeZH, "Workbench is temporarily unavailable. Try again later.")
	if got != "工作台暂时不可用，请稍后重试" {
		t.Fatalf("zh unavailable = %q", got)
	}
}
