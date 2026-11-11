package main

import "testing"

func TestParseOCRTranscriptWechatProbe(t *testing.T) {
	text := `微信支付交易明细证明（合成探测页）

兹证明：合成持有人
账号：6222000011112222
期间：2026-01-01 至 2026-01-31

交易时间 收/支 金额(元) 交易对方 交易类型
2026-01-05 10:11 收入 1280.50 华丰商贸 转账
2026-01-08 09:00 收入 0.36 结息账户 利息
2026-01-12 18:20 支出 86.00 超市 消费
2026-01-18 12:00 收入 500.00 微信零钱提现 提现
2026-01-22 15:30 收入 3200.00 李客户 货款

探测标记：NO996-OCR-PROBE-20261111`

	source, rows, err := parseOCRTranscript(text, "other")
	if err != nil {
		t.Fatal(err)
	}
	if source != "wechat_statement" {
		t.Fatalf("source=%q", source)
	}
	if len(rows) != 5 {
		t.Fatalf("rows=%d want 5", len(rows))
	}
	if str(rows[0], "date") != "2026-01-05" {
		t.Fatalf("date0=%q", str(rows[0], "date"))
	}
	if integer(rows[0]["income"]) != 128050 {
		t.Fatalf("income0=%v", rows[0]["income"])
	}
	if integer(rows[2]["expense"]) != 8600 {
		t.Fatalf("expense2=%v", rows[2]["expense"])
	}
	if str(rows[0], "counterparty") != "华丰商贸" {
		t.Fatalf("cp=%q", str(rows[0], "counterparty"))
	}
}

func TestParseOCRTranscriptRequiresHeader(t *testing.T) {
	_, _, err := parseOCRTranscript("只有几行废话\n没有表头", "wechat_statement")
	if err == nil {
		t.Fatal("expected error")
	}
}

// 回归：工作台 page_ocr 若缺 result.text，清流写回必须失败（真机曾 400「没有转写正文」）。
func TestWritebackPageOCRRequiresText(t *testing.T) {
	a := &App{}
	n, err := a.writebackPageOCR("cid", "doc", "x.pdf", Object{
		"summary": "已识别 1 页",
		"process": []any{Object{"text": "逐页识别完成"}},
	})
	if err == nil || n != 0 {
		t.Fatalf("want error for missing text, got n=%d err=%v", n, err)
	}
	if err.Error() != "分析结果没有转写正文" {
		t.Fatalf("err=%q", err.Error())
	}
}
