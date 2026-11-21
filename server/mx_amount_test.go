package main

import "testing"

// 回归：单列带符号金额（招行 mx 导出）必须能解析出方向。
// 原文形如：`269 | 2026-03-11 | CNY | -100,000.00 | 3,318.85网银跨行互联/.../万军`
func TestStandardSingleSignedAmount(t *testing.T) {
	cases := []struct {
		name      string
		amount    string
		wantDir   string
		wantInc   int64
		wantExp   int64
		wantQual  string
	}{
		{"负数=流出", "-100,000.00", "expense", 0, 10000000, "structured"},
		{"正数=流入", "40,621.87", "income", 4062187, 0, "structured"},
		{"零金额无方向", "0.00", "", 0, 0, "invalid"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := Object{
				"date":   "2026-03-11",
				"amount": tc.amount,
				"memo":   "网银跨行互联/6222031211008299786/万军",
			}
			got := standard(raw, "bank_statement", 1, "pdf:row:1")
			if got["quality"] != tc.wantQual {
				t.Fatalf("quality = %v, want %v (err=%v)", got["quality"], tc.wantQual, got["error"])
			}
			if tc.wantQual != "structured" {
				return
			}
			if got["direction"] != tc.wantDir {
				t.Fatalf("direction = %v, want %v", got["direction"], tc.wantDir)
			}
			if got["income"] != tc.wantInc {
				t.Fatalf("income = %v, want %d", got["income"], tc.wantInc)
			}
			if got["expense"] != tc.wantExp {
				t.Fatalf("expense = %v, want %d", got["expense"], tc.wantExp)
			}
		})
	}
}

// cents 必须接受带负号与千分位的金额。
func TestCentsNegativeWithCommas(t *testing.T) {
	got, err := cents("-100,000.00")
	if err != nil {
		t.Fatalf("cents: %v", err)
	}
	if got != -10000000 {
		t.Fatalf("cents = %d, want -10000000", got)
	}
}
