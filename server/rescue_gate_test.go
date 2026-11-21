package main

import (
	"strings"
	"testing"
)

// 通用性回归：规则抽出大量 invalid 行时，必须允许 AI 兜底介入。
// 旧逻辑是 `len(Rows)>0 → return false`，导致没见过的版式永远没机会被 AI 重排。
func TestNeedsAIRescueOnLowUsability(t *testing.T) {
	// 5 行全部 invalid —— 就是"没见过的版式"的典型形态
	allBad := &ParseResult{Rows: []Object{
		{"quality": "invalid", "raw": "W0001,20260105,CNY,-2500.00,支付货款"},
		{"quality": "invalid", "raw": "W0002,20260106,CNY,8800.00,收到回款"},
		{"quality": "invalid", "raw": "W0003,20260108,CNY,-120.50,手续费"},
	}}
	if !needsAIRescue(allBad) {
		t.Fatal("全 invalid 但未触发 AI 兜底")
	}

	// 一半可用 —— 也该兜底（低于 0.8）
	half := &ParseResult{Rows: []Object{
		{"quality": "structured"},
		{"quality": "structured"},
		{"quality": "invalid"},
		{"quality": "invalid"},
	}}
	if !needsAIRescue(half) {
		t.Fatal("可用率 0.5 但未触发 AI 兜底")
	}

	// 全部可用 —— 不该打扰 AI
	good := &ParseResult{Rows: []Object{
		{"quality": "structured"},
		{"quality": "structured"},
		{"quality": "structured"},
		{"quality": "structured"},
		{"quality": "structured"},
	}}
	if needsAIRescue(good) {
		t.Fatal("全部可用却触发了 AI 兜底")
	}

	// 空行 —— 必须兜底
	if !needsAIRescue(&ParseResult{}) {
		t.Fatal("零行未触发 AI 兜底")
	}
}

// 结构化导入没有 ocr_text/extract_text 时，兜底输入必须能从行的 raw 字段拼出来，
// 否则"交给 AI 重排"这条路径等于不存在。
func TestStructureRescueInputFallsBackToRowRaw(t *testing.T) {
	result := &ParseResult{
		Rows: []Object{
			{"quality": "invalid", "raw": "W0001,20260105,CNY,-2500.00,支付货款"},
			{"quality": "invalid", "raw": "W0002,20260106,CNY,8800.00,收到回款"},
		},
		Meta: Object{"source": "bank_statement"},
	}
	got := structureRescueInput(result)
	if got == "" {
		t.Fatal("结构化导入的兜底输入为空，AI 重排不可能发生")
	}
	if !strings.Contains(got, "W0001") || !strings.Contains(got, "W0002") {
		t.Fatalf("兜底输入缺行原文: %q", got)
	}
}

// 端到端触发条件：未知版式必须让 shouldTryStructureRescueAfterOCR 放行。
func TestShouldTryRescueForUnknownLayout(t *testing.T) {
	result := &ParseResult{
		Rows: []Object{
			{"quality": "invalid", "raw": "W0001,20260105,CNY,-2500.00,支付货款"},
		},
		Meta: Object{"source": "bank_statement"},
	}
	payload := Object{"source": "bank_statement"}
	if !shouldTryStructureRescueAfterOCR(payload, result) {
		t.Fatal("未知版式未放行 AI 兜底")
	}
}
