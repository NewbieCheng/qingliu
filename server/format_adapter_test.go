package main

import "testing"

// 表头签名必须稳定：列顺序变、换行方式不同，都应该命中同一条适配器，
// 否则同一家银行换个导出顺序就要重新问一次 AI。
func TestHeaderSignatureStable(t *testing.T) {
	a := headerSignature([]string{"交易日期", "币种", "交易金额", "账户余额", "摘要/备注", "对方账号/户名"})
	b := headerSignature([]string{"对方账号/户名", "摘要/备注", "账户余额", "交易金额", "币种", "交易日期"})
	if a != b {
		t.Fatalf("列顺序不应影响签名: %q vs %q", a, b)
	}
	if a == "" {
		t.Fatal("正常表头不应得到空签名")
	}
	// 序号列不参与签名（有的银行有、有的没有）
	c := headerSignature([]string{"序号", "交易日期", "币种", "交易金额", "账户余额", "摘要/备注", "对方账号/户名"})
	if c != a {
		t.Fatalf("序号列不应影响签名: %q vs %q", c, a)
	}
	// 列太少说明不是真表头，不学
	if headerSignature([]string{"日期", "金额"}) != "" {
		t.Fatal("少于 3 列不应生成签名")
	}
}

// AI 输出一律当不可信数据：白名单外的字段/切分器必须丢掉，
// 不能让它影响解析主流程。
func TestSanitizeAdapterDropsUnknown(t *testing.T) {
	in := AdapterMapping{
		Aliases: map[string]string{
			"对方账号/户名": "counter_both", // 允许
			"交易日期":    "date",           // 允许
			"随便一列":    "evil_field",     // 不在白名单，丢
			"另一列":     "",               // 空值，丢
		},
		Splitters: map[string]string{
			"counter_both": "account_name", // 允许
			"amount":       "rm -rf /",     // 不在白名单，丢
		},
		Note: "测试",
	}
	out := sanitizeAdapter(in)
	if _, ok := out.Aliases["随便一列"]; ok {
		t.Fatal("白名单外字段不应保留")
	}
	if out.Aliases["对方账号/户名"] != "counter_both" {
		t.Fatal("白名单内字段应保留")
	}
	if _, ok := out.Splitters["amount"]; ok {
		t.Fatal("白名单外切分器不应保留")
	}
	if out.Splitters["counter_both"] != "account_name" {
		t.Fatal("白名单内切分器应保留")
	}
}

// 适配器只补空缺，不能覆盖人工确认过的硬编码别名。
func TestApplyAdapterDoesNotOverrideKnownAliases(t *testing.T) {
	labels := map[string]string{"金额": "amount"}
	m := &AdapterMapping{Aliases: map[string]string{
		"金额":   "income", // 想覆盖，必须被忽略
		"新列名": "memo",   // 空缺，应该补上
	}}
	applyAdapter(labels, m)
	if labels["金额"] != "amount" {
		t.Fatalf("硬编码别名被 AI 覆盖了: %q", labels["金额"])
	}
	if labels["新列名"] != "memo" {
		t.Fatal("空缺别名应被补上")
	}
	// nil 适配器不应 panic
	applyAdapter(labels, nil)
}
