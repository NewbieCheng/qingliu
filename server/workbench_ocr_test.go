package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseBillingTierAvoidsDoubleChargeForWorkbenchOCR(t *testing.T) {
	res := ParseResult{
		Meta: Object{"method": "workbench-ocr", "pages": 3},
	}
	tier := parseBillingTier(res)
	if tier != "workbench-billed" {
		t.Fatalf("parseBillingTier = %q, want workbench-billed", tier)
	}
	cost := (parsePricing{Text: 1, OCR: 2, Vision: 5}).parseCost(tier, 3)
	if cost != 0 {
		t.Fatalf("parseCost for workbench-billed = %d, want 0 (must not double charge)", cost)
	}
}

func TestWBConfigCallOCRAndApplyResult(t *testing.T) {
	var seenAuth, seenPurpose, seenFile string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/ocr" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		seenAuth = r.Header.Get("Authorization")
		if err := r.ParseMultipartForm(4 << 20); err != nil {
			t.Fatalf("ParseMultipartForm: %v", err)
		}
		seenPurpose = r.FormValue("purpose")
		_, fh, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("FormFile: %v", err)
		}
		seenFile = fh.Filename
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"text": `微信支付交易明细证明
交易时间 收/支 金额(元) 交易对方 交易类型
2026-01-05 10:11 收入 1280.50 华丰商贸 转账`,
			"page_count":   2,
			"channel_used": "deepseek/ocr",
		})
	}))
	defer server.Close()

	cfg := wbConfig{
		BaseURL:  server.URL,
		ClientID: "ql",
		Secret:   "secret",
		Client:   server.Client(),
	}
	status, ocrRes, msg, err := cfg.callOCR(context.Background(), "jwt-test-123", []byte("%PDF-mock"), "statement.pdf", "text_recognition")
	if err != nil || status != http.StatusOK {
		t.Fatalf("callOCR status=%d err=%v msg=%s", status, err, msg)
	}
	if seenAuth != "Bearer jwt-test-123" || seenPurpose != "text_recognition" || seenFile != "statement.pdf" {
		t.Fatalf("unexpected multipart fields: auth=%q purpose=%q file=%q", seenAuth, seenPurpose, seenFile)
	}

	parsed := ParseResult{
		Meta: Object{"source": "other", "status": "failed", "method": "needs-vision", "text_pages": 0, "issues": []string{"旧提示"}},
	}
	if !shouldTryWorkbenchOCR(Object{"name": "statement.pdf"}, &parsed) {
		t.Fatal("shouldTryWorkbenchOCR should return true for scanned PDF")
	}
	applyWorkbenchOCRResult(&parsed, ocrRes)
	if str(parsed.Meta, "method") != "workbench-ocr" || str(parsed.Meta, "status") != "success" {
		t.Fatalf("unexpected Meta after applyWorkbenchOCRResult: %+v", parsed.Meta)
	}
	if str(parsed.Meta, "channel_used") != "deepseek/ocr" || len(parsed.Rows) != 1 {
		t.Fatalf("unexpected rows/channel: channel=%q rows=%d", str(parsed.Meta, "channel_used"), len(parsed.Rows))
	}
	if !strings.Contains(str(parsed.Meta, "ocr_text"), "华丰商贸") {
		t.Fatalf("missing ocr_text in Meta: %+v", parsed.Meta)
	}
}
