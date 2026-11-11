package main

import "testing"

func TestAcceptClientParsedRows(t *testing.T) {
	rows := []Object{
		{
			"locator": "row:2",
			"raw":     `{"交易日期":"2026-01-05","收支方向":"收入","金额":"1280.50","交易对方":"华丰商贸","摘要":"货款","本方账号":"6222"}`,
		},
		{
			"locator": "row:3",
			"raw":     `{"交易日期":"2026-01-12","收支方向":"支出","金额":"86.00","交易对方":"超市","摘要":"消费","本方账号":"6222"}`,
		},
	}
	out, err := acceptClientParsedRows(rows, "bank_statement")
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 {
		t.Fatalf("rows=%d", len(out))
	}
	if str(out[0], "direction") != "income" || integer(out[0]["income"]) != 128050 {
		t.Fatalf("income row=%v", out[0])
	}
	if str(out[1], "direction") != "expense" || integer(out[1]["expense"]) != 8600 {
		t.Fatalf("expense row=%v", out[1])
	}
}

func TestAcceptClientParsedRowsRejectsMissingRaw(t *testing.T) {
	_, err := acceptClientParsedRows([]Object{{"locator": "row:2"}}, "bank_statement")
	if err == nil {
		t.Fatal("expected error")
	}
}
