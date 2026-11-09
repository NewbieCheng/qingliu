package main

import (
	"os"
	"strings"
	"testing"
)

// 工作台现在会返回 reason_code/trace_id；清流必须把它们透传给用户，
// 否则又回到“文件解析失败”这一句无法排查的提示。
func TestWbFailureKeepsReasonCodeAndTrace(t *testing.T) {
	data := Object{"error": Object{
		"code":     "AI_DOC_EXTRACTION_FAILED",
		"message":  "文件解析失败",
		"trace_id": "trace-123",
		"details":  map[string]any{"reason_code": "PDF_TOOL_EXIT", "detail": "pdftotext: exit status 1"},
	}}
	message := wbFailure(data, nil, "兜底")
	for _, want := range []string{"文件解析失败", "AI_DOC_EXTRACTION_FAILED", "PDF_TOOL_EXIT", "trace-123"} {
		if !containsText(message, want) {
			t.Fatalf("message %q missing %q", message, want)
		}
	}
}

func TestWbFailureFallsBackWhenDataEmpty(t *testing.T) {
	if got := wbFailure(nil, nil, "兜底"); got != "兜底" {
		t.Fatalf("got %q", got)
	}
}

func containsText(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (haystack == needle ||
		len(needle) == 0 ||
		indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

// 服务间调用必须带服务凭证：之前只对登录设置，计费与计价接口因此全部 403，
// 表现是「解析成功但一分钱没扣」，且日志里只有一行 pricing load failed。
func TestServicePathsCarryServiceCredentials(t *testing.T) {
	source, err := os.ReadFile("workbench.go")
	if err != nil {
		t.Fatalf("read workbench.go: %v", err)
	}
	text := string(source)
	if !strings.Contains(text, `strings.HasPrefix(path, "/api/v1/service/")`) {
		t.Fatal("service credentials must be attached for every /api/v1/service/ path, not just login")
	}
	for _, header := range []string{"X-Service-Client", "X-Service-Secret"} {
		if !strings.Contains(text, header) {
			t.Fatalf("missing %s header", header)
		}
	}
}
