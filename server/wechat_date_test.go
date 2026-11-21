package main

import "testing"

// 回归：微信/支付宝 CSV 只有「交易时间」一列（完整 datetime），
// 必须能从它取出日期，否则整份流水判「日期无效」。
func TestStandardWechatDatetimeOnly(t *testing.T) {
	cases := []Object{
		{"交易单号": "WX20260103001", "交易对方": "邻里小店", "交易时间": "2026-01-03 10:11:12", "交易类型": "转账", "收/支": "支出", "金额(元)": "12.00"},
		{"交易订单号": "ALI20260104001", "交易对方": "网店买家", "交易时间": "2026-01-04 08:30:00", "商品说明": "商品货款", "收/支": "收入", "金额(元)": "88.00"},
	}
	for i, raw := range cases {
		got := standard(raw, "wechat_statement", 1, "csv:row:1")
		if got["quality"] != "structured" {
			t.Fatalf("case %d: quality = %v, error = %v, date = %q",
				i, got["quality"], got["error"], got["date"])
		}
		if got["date"] == "" {
			t.Fatalf("case %d: date empty", i)
		}
	}
}
