package main

import (
	"strings"
	"testing"
)

// 这条链路回答的是用户的问题：
// "OCR/AI 出来的东西跟后面流程不匹配时，该怎么办？"
//
// 契约：AI 优先给结构化 JSON；给不出就退回表格文本；都不行要给出**可读原因**，
// 而不是一句含糊的"没有可解析的交易行"。

func TestParseRescueJSONPlain(t *testing.T) {
	out := `{"source":"bank_statement","rows":[{"date":"2026-01-05","direction":"expense","amount":"2500.00","counterparty":"杭州甲贸易","memo":"支付货款"}]}`
	source, rows, err := parseRescueJSON(out)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if source != "bank_statement" || len(rows) != 1 {
		t.Fatalf("source=%q rows=%d", source, len(rows))
	}
	if str(rows[0], "amount") != "2500.00" {
		t.Fatalf("amount = %v", rows[0]["amount"])
	}
}

// 模型经常包 ```json 围栏，必须容错。
func TestParseRescueJSONWithCodeFence(t *testing.T) {
	out := "```json\n{\"source\":\"alipay_statement\",\"rows\":[{\"date\":\"2026-02-01\",\"direction\":\"income\",\"amount\":\"88.00\"}]}\n```"
	source, rows, err := parseRescueJSON(out)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if source != "alipay_statement" || len(rows) != 1 {
		t.Fatalf("source=%q rows=%d", source, len(rows))
	}
}

// 模型前后加解释性文字时，截取 JSON 块。
func TestParseRescueJSONWithChatter(t *testing.T) {
	out := "好的，结果如下：\n{\"source\":\"wechat_statement\",\"rows\":[{\"date\":\"2026-03-01\",\"direction\":\"expense\",\"amount\":\"12.00\"}]}\n以上。"
	source, rows, err := parseRescueJSON(out)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if source != "wechat_statement" || len(rows) != 1 {
		t.Fatalf("source=%q rows=%d", source, len(rows))
	}
}

// 模型明确说没有流水：rows 为空但不是错误，交给上层判"无交易记录"。
func TestParseRescueJSONNoRows(t *testing.T) {
	out := `{"source":"other","rows":[]}`
	_, rows, err := parseRescueJSON(out)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows = %d, want 0", len(rows))
	}
}

// 完全不是 JSON：必须返回错误（由 apply 层退回表格解析或给用户提示）。
func TestParseRescueJSONGarbage(t *testing.T) {
	if _, _, err := parseRescueJSON("这不是 JSON"); err == nil {
		t.Fatal("garbage 应当报错")
	}
}

// 方向词归一：模型给英文档位也要能进 standard()。
func TestDirectionWordMapping(t *testing.T) {
	cases := map[string]string{
		"income": "收入", "expense": "支出", "neutral": "不计收支",
		"INCOME": "收入", "out": "支出", "其他": "其他",
	}
	for in, want := range cases {
		if got := directionWord(in); got != want {
			t.Fatalf("directionWord(%q) = %q, want %q", in, got, want)
		}
	}
}

// JSON 行转内部行：负数金额必须转成 expense（不能变成 invalid）。
func TestRowsFromJSONNegativeAmountBecomesExpense(t *testing.T) {
	rows := rowsFromJSON("bank_statement", []Object{
		{"date": "2026-01-05", "direction": "", "amount": "-2500.00", "counterparty": "甲", "memo": "货款"},
		{"date": "2026-01-06", "direction": "income", "amount": "8800.00", "counterparty": "乙", "memo": "回款"},
	})
	if len(rows) != 2 {
		t.Fatalf("rows = %d", len(rows))
	}
	if str(rows[0], "quality") == "invalid" {
		t.Fatalf("负数金额被判 invalid: %v", rows[0]["error"])
	}
	if str(rows[0], "direction") != "expense" {
		t.Fatalf("负数方向 = %q, want expense", str(rows[0], "direction"))
	}
	if str(rows[1], "direction") != "income" {
		t.Fatalf("第二行方向 = %q, want income", str(rows[1], "direction"))
	}
}

// 端到端：新契约走通，不需要退回表格解析。
func TestApplyRescueResultPrefersJSON(t *testing.T) {
	result := &ParseResult{Meta: Object{"source": "bank_statement"}}
	out := `{"source":"bank_statement","rows":[{"date":"2026-01-05","direction":"expense","amount":"2500.00","counterparty":"甲","memo":"货款"}]}`
	if err := applyStructureRescueResult(result, out); err != nil {
		t.Fatalf("apply err = %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("rows = %d", len(result.Rows))
	}
	if str(result.Meta, "method") != "workbench-structure" {
		t.Fatalf("method = %q", str(result.Meta, "method"))
	}
}

// 端到端：老模型仍给表格文本时，兼容路径必须还能用。
func TestApplyRescueResultFallsBackToTable(t *testing.T) {
	result := &ParseResult{Meta: Object{"source": "bank_statement"}}
	out := "交易时间 收支 金额 对手方 摘要\n2026-01-05 支出 2500.00 甲 货款"
	if err := applyStructureRescueResult(result, out); err != nil {
		t.Fatalf("apply err = %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("rows = %d", len(result.Rows))
	}
}

// 端到端：两条路都不行时，错误信息必须说清两条路各自为什么失败。
func TestApplyRescueResultReportsBothFailures(t *testing.T) {
	result := &ParseResult{Meta: Object{"source": "bank_statement"}}
	err := applyStructureRescueResult(result, "这是完全无法解析的一段话")
	if err == nil {
		t.Fatal("应当报错")
	}
	msg := err.Error()
	if !strings.Contains(msg, "JSON") {
		t.Fatalf("错误信息未说明 JSON 路失败: %q", msg)
	}
	if !strings.Contains(msg, "表格") {
		t.Fatalf("错误信息未说明表格路失败: %q", msg)
	}
}
