package main

import (
	"strings"
	"testing"
)

func TestShouldTryWorkbenchOCRTightened(t *testing.T) {
	payload := Object{"name": "scan.pdf"}
	if !shouldTryWorkbenchOCR(payload, &ParseResult{Meta: Object{"method": "needs-vision"}}) {
		t.Fatal("needs-vision must trigger workbench OCR")
	}
	if !shouldTryWorkbenchOCR(payload, &ParseResult{Meta: Object{
		"method":       "text-layer",
		"source":       "bank_statement",
		"text_pages":   2,
		"extract_text": "交易时间 金额",
	}}) {
		t.Fatal("match-failed text PDF must trigger OCR")
	}
	if shouldTryWorkbenchOCR(payload, &ParseResult{Meta: Object{
		"method": "local-ocr",
		"source": "credit_report",
		"ocr_pages": 2,
	}}) {
		t.Fatal("credit reports must not force OCR for missing rows")
	}
	okRows := &ParseResult{Rows: []Object{{"date": "2026-01-01"}}, Meta: Object{"method": "text-layer"}}
	if shouldTryWorkbenchOCR(payload, okRows) {
		t.Fatal("already-parsed docs must not re-OCR")
	}
}

func TestShouldTryStructureRescueAfterOCR(t *testing.T) {
	payload := Object{"name": "statement.pdf", "source": "wechat_statement"}
	pending := &ParseResult{Meta: Object{
		"source":   "wechat_statement",
		"method":   "workbench-ocr",
		"ocr_text": "乱七八糟的 OCR 正文，没有标准表头",
		"status":   "partial",
	}}
	if !shouldTryStructureRescueAfterOCR(payload, pending) {
		t.Fatal("expected structure rescue when OCR text exists but rows empty")
	}

	pending.Rows = []Object{{"date": "2026-01-01"}}
	if shouldTryStructureRescueAfterOCR(payload, pending) {
		t.Fatal("skip when rows already present")
	}

	credit := &ParseResult{Meta: Object{
		"source":   "credit_report",
		"ocr_text": "报告日期",
	}}
	if shouldTryStructureRescueAfterOCR(Object{"name": "credit.pdf"}, credit) {
		t.Fatal("credit reports should not enter transaction structure rescue")
	}
}

func TestApplyStructureRescueResult(t *testing.T) {
	result := &ParseResult{Meta: Object{"source": "wechat_statement", "status": "partial", "method": "workbench-ocr"}}
	transcript := strings.Join([]string{
		"微信支付交易明细证明",
		"交易时间 收/支 金额(元) 交易对方 交易类型",
		"2026-01-05 10:11 收入 1280.50 华丰商贸 转账",
		"2026-01-12 18:20 支出 86.00 超市 消费",
	}, "\n")
	if err := applyStructureRescueResult(result, transcript); err != nil {
		t.Fatal(err)
	}
	if str(result.Meta, "method") != "workbench-structure" {
		t.Fatalf("method=%q", str(result.Meta, "method"))
	}
	if len(result.Rows) != 2 {
		t.Fatalf("rows=%d", len(result.Rows))
	}
	if parseBillingTier(*result) != "workbench-billed" {
		t.Fatalf("billing tier=%q", parseBillingTier(*result))
	}
}

func TestApplyWorkbenchOCRResultThenNeedsRescue(t *testing.T) {
	result := &ParseResult{Meta: Object{"source": "bank_statement", "status": "failed"}}
	applyWorkbenchOCRResult(result, wbOCRResult{
		Text:        "这是一段无法直接套表的 OCR 正文",
		PageCount:   1,
		ChannelUsed: "deepseek/ocr",
	})
	if str(result.Meta, "method") != "workbench-ocr" {
		t.Fatalf("method=%q", str(result.Meta, "method"))
	}
	if str(result.Meta, "ocr_text") == "" {
		t.Fatal("ocr_text must be retained for structure rescue")
	}
	if len(result.Rows) != 0 {
		t.Fatal("unparseable OCR must not invent rows")
	}
	if str(result.Meta, "status") != "partial" {
		t.Fatalf("status=%q want partial", str(result.Meta, "status"))
	}
	if !shouldTryStructureRescueAfterOCR(Object{"name": "a.pdf"}, result) {
		t.Fatal("unparseable OCR should qualify for structure rescue")
	}
}
