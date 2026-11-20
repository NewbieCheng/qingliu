package main

import (
	"archive/zip"
	"bytes"
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

func TestImageUploadParseAndOCRFlow(t *testing.T) {
	pngBytes := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00, 0x00, 0x00, 0x0d}
	parsed, err := parseFile(context.Background(), pngBytes, "wechat-shot.png", "other", nil)
	if err != nil {
		t.Fatalf("parseFile image failed: %v", err)
	}
	if integer(parsed.Meta["pages"]) != 1 || str(parsed.Meta, "method") != "needs-vision" {
		t.Fatalf("unexpected image parse meta: %+v", parsed.Meta)
	}
	if !shouldTryWorkbenchOCR(Object{"name": "wechat-shot.png", "source": "other"}, &parsed) {
		t.Fatal("shouldTryWorkbenchOCR must be true for uploaded image")
	}

	applyWorkbenchOCRResult(&parsed, wbOCRResult{
		Text: `微信支付交易明细证明
交易时间 收/支 金额(元) 交易对方 交易类型
2026-01-05 10:11 收入 1280.50 华丰商贸 转账`,
		PageCount:   1,
		ChannelUsed: "xiaomi/mimo-v2.6-pro",
	})
	if str(parsed.Meta, "status") != "success" || str(parsed.Meta, "source") != "wechat_statement" || len(parsed.Rows) != 1 {
		t.Fatalf("unexpected image OCR result: meta=%+v rows=%d", parsed.Meta, len(parsed.Rows))
	}
}

func TestCreditReportImageExtractsFactsWithoutTransactions(t *testing.T) {
	jpgBytes := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01}
	parsed, err := parseFile(context.Background(), jpgBytes, "credit.jpg", "credit_report", nil)
	if err != nil {
		t.Fatalf("parseFile jpg failed: %v", err)
	}
	if !shouldTryWorkbenchOCR(Object{"name": "credit.jpg", "source": "credit_report"}, &parsed) {
		t.Fatal("credit_report image should still trigger OCR for facts")
	}
	applyWorkbenchOCRResult(&parsed, wbOCRResult{
		Text:        "个人信用报告 贷款余额 100000 元",
		PageCount:   1,
		ChannelUsed: "xiaomi/mimo-v2.6-pro",
	})
	if str(parsed.Meta, "status") != "success" || len(parsed.Rows) != 0 || len(list(parsed.Meta["facts"])) != 1 {
		t.Fatalf("unexpected credit_report image result: meta=%+v rows=%d", parsed.Meta, len(parsed.Rows))
	}
}

func TestReadAndValidateUploadFileLimitsAndMagicBytes(t *testing.T) {
	// 伪造 PNG 头应被拒绝
	_, err := readAndValidateUploadFile("fake.png", 16, func(limit int64) ([]byte, error) {
		return []byte("not-a-real-png-bytes"), nil
	})
	if err == nil || !strings.Contains(err.Error(), "图片内容无效") {
		t.Fatalf("expected invalid image error, got %v", err)
	}

	// 单张图片超过 20MB 应被拒绝
	_, err = readAndValidateUploadFile("big.jpg", maxUploadImageBytes+1, func(limit int64) ([]byte, error) {
		return nil, nil
	})
	if err == nil || !strings.Contains(err.Error(), "20MB") {
		t.Fatalf("expected 20MB image limit error, got %v", err)
	}

	// 合法 WebP 应放行
	webp := []byte{'R', 'I', 'F', 'F', 0x24, 0x00, 0x00, 0x00, 'W', 'E', 'B', 'P'}
	got, err := readAndValidateUploadFile("shot.webp", int64(len(webp)), func(limit int64) ([]byte, error) {
		return webp, nil
	})
	if err != nil || len(got) != len(webp) {
		t.Fatalf("expected valid webp to pass, got len=%d err=%v", len(got), err)
	}
}

func TestMixedOtherSourceCSVAndDocxParse(t *testing.T) {
	csvBytes := []byte("交易日期,收支方向,金额,交易对方,摘要\n2026-01-05,收入,1280.50,华丰商贸,货款\n")
	res, err := parseFile(context.Background(), csvBytes, "mix.csv", "other", nil)
	if err != nil {
		t.Fatalf("parseFile csv with source=other failed: %v", err)
	}
	if str(res.Meta, "source") != "bank_statement" || len(res.Rows) != 1 {
		t.Fatalf("expected inferred bank_statement with 1 row, got meta=%+v rows=%d", res.Meta, len(res.Rows))
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	f, _ := zw.Create("word/document.xml")
	_, _ = f.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>支付宝交易流水</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>交易日期</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>收支方向</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>2026-01-06</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>支出</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>50.00</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`))
	_ = zw.Close()

	docxRes, err := parseFile(context.Background(), buf.Bytes(), "statement.docx", "other", nil)
	if err != nil {
		t.Fatalf("parseFile docx failed: %v", err)
	}
	if str(docxRes.Meta, "source") != "alipay_statement" || len(docxRes.Rows) != 1 {
		t.Fatalf("expected docx alipay_statement with 1 row, got meta=%+v rows=%d", docxRes.Meta, len(docxRes.Rows))
	}
}
