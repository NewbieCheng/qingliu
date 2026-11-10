package main

import (
	"os"
	"strings"
	"testing"
)

func TestIsServiceAPI(t *testing.T) {
	if !isServiceAPI("/api/service/audit") {
		t.Fatal("expected /api/service/audit to be service API")
	}
	if !isServiceAPI("/api/service/audit/purge") {
		t.Fatal("expected purge path to be service API")
	}
	if isServiceAPI("/api/admin/audit") {
		t.Fatal("admin audit must stay session-bound")
	}
}

func TestServiceAuditSourceMentionsSharedSecret(t *testing.T) {
	raw, err := os.ReadFile("service_audit.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, want := range []string{
		"X-Service-Client",
		"X-Service-Secret",
		"GET /api/service/audit",
		"POST /api/service/audit/purge",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("service_audit.go missing %q", want)
		}
	}
}
