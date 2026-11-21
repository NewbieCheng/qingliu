package main

import "testing"

// 银行流水常把「对方账号/户名」合成一列。不拆开的话对手方永远是空的，
// 用户在核对页只看得到"原件未记载"，一脸懵。
func TestSplitCounterparty(t *testing.T) {
	cases := []struct {
		in      string
		account string
		name    string
	}{
		// 泰隆银行实际格式：账号在前，户名在后
		{"11123338871/蒋丰蔚", "11123338871", "蒋丰蔚"},
		{"999999915612242008300028/聚合支付商户待清算账户", "999999915612242008300028", "聚合支付商户待清算账户"},
		// 反过来写的银行
		{"蒋丰蔚/11123338871", "11123338871", "蒋丰蔚"},
		// 只有一半
		{"11123338871", "11123338871", ""},
		{"蒋丰蔚", "", "蒋丰蔚"},
		// 掩码账号
		{"6222****9786/万军", "6222****9786", "万军"},
		// 两边都不像账号：整串保留为户名，不能截断真实公司名
		{"绍兴杭才科技有限公司/备用金", "", "绍兴杭才科技有限公司/备用金"},
		// 空
		{"", "", ""},
	}
	for _, c := range cases {
		acc, name := splitCounterparty(c.in)
		if acc != c.account || name != c.name {
			t.Errorf("splitCounterparty(%q) = (%q, %q), want (%q, %q)",
				c.in, acc, name, c.account, c.name)
		}
	}
}

// 表头别名必须能认出「摘要/备注」和「对方账号/户名」，
// 否则这两列不会被当成独立列，整行右侧会粘成一列。
func TestHeaderAliasesCoverSlashLabels(t *testing.T) {
	want := map[string]string{
		"摘要/备注":   "memo",
		"对方账号/户名": "counter_both",
		"账户余额":    "balance",
	}
	labels := map[string]string{}
	for k, aa := range aliases {
		for _, a := range append([]string{k}, aa...) {
			labels[normalize(a)] = k
		}
	}
	for label, key := range map[string]string{
		"本次余额": "balance", "账户余额": "balance", "余额": "balance",
	} {
		labels[normalize(label)] = key
	}
	for label, expect := range want {
		if got := labels[normalize(label)]; got != expect {
			t.Errorf("表头 %q 应识别为 %q，实际 %q", label, expect, got)
		}
	}
}
