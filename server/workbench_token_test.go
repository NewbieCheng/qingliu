package main

import (
	"os"
	"strings"
	"testing"
)

func TestIntegerParsesStringTokenExpires(t *testing.T) {
	if got := integer("1794289982"); got != 1794289982 {
		t.Fatalf("string token_expires = %d", got)
	}
	if got := integer([]byte("1794289982")); got != 1794289982 {
		t.Fatalf("[]byte token_expires = %d", got)
	}
	if got := integer(""); got != 0 {
		t.Fatalf("empty string = %d", got)
	}
}

func TestWbAccessTokenPropagatesRefreshErrors(t *testing.T) {
	raw, err := os.ReadFile("workbench.go")
	if err != nil {
		t.Fatalf("read workbench.go: %v", err)
	}
	source := string(raw)
	// Regression: refresh failures used to collapse into an empty token, so a
	// down workbench surfaced as「请重新登录工作台账号」on /api/billing/*.
	for _, want := range []string{
		`return a.wbRefresh(userID)`,
		`return "", err`,
		`return http.StatusUnauthorized, nil, err`,
		`return http.StatusUnauthorized, nil, refreshErr`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("workbench.go missing %q — refresh errors must reach the caller", want)
		}
	}
	for _, banned := range []string{
		`if refreshed, ok := a.wbRefresh(userID); ok {`,
		`func (a *App) wbRefresh(userID string) (string, bool)`,
		`func (a *App) wbAccessToken(userID string) string {`,
	} {
		if strings.Contains(source, banned) {
			t.Fatalf("workbench.go still has old swallow-refresh shape: %q", banned)
		}
	}
}
