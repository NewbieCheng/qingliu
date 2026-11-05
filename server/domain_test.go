package main

import (
	"context"
	"github.com/xuri/excelize/v2"
	"os"
	"path/filepath"
	"testing"
)

func TestCents(t *testing.T) {
	for s, want := range map[string]int64{"100.01": 10001, "0.005": 1, "-0.005": -1, "￥1,234.56": 123456, "１００.０１": 10001} {
		got, e := cents(s)
		if e != nil || got != want {
			t.Fatalf("%s = %d %v", s, got, e)
		}
	}
	for _, s := range []string{"NaN", "1e3", "", "--1", "100000000000001"} {
		if _, e := cents(s); e == nil {
			t.Fatalf("accepted %q", s)
		}
	}
}
func TestInvalidImportNeverGuesses(t *testing.T) {
	for _, raw := range []Object{{"date": "2026-01-01", "income": "-1"}, {"date": "2026-01-01", "income": "1", "expense": "1"}, {"date": "2026-01-01", "direction": "收入", "expense": "2"}, {"date": "wrong", "amount": "1", "direction": "收入"}} {
		row := standard(raw, "bank_statement", 1, "test")
		if str(row, "quality") != "invalid" {
			t.Fatalf("accepted %v", raw)
		}
	}
}
func testRows() []Object {
	out := []Object{}
	for i, raw := range []Object{{"date": "2025-10-15", "income": "100", "memo": "货款"}, {"date": "2025-10-15", "income": "100", "memo": "货款"}, {"date": "2025-11-01", "income": "200", "memo": "货款"}} {
		r := standard(raw, "bank_statement", 0, "test")
		r["document_id"] = "doc"
		r["duplicate"] = i == 1
		out = append(out, r)
	}
	return out
}
func TestAccountingAndOwnershipMatchLegacy(t *testing.T) {
	rows := testRows()
	fields := Object{"document_scopes": Object{"doc": Object{"confirmed": true, "include": true, "holder": "合成人员"}}}
	rows = evaluate(rows, defaultRules(), fields)
	s := summary(rows, "bank_statement", "2025-10-15", "2026-10-14")
	for k, n := range map[string]int64{"original_income": 40000, "income": 30000, "quarantined_income": 10000, "month_count": 13, "complete_month_count": 11, "complete_month_average": 1818, "average": 2308} {
		if integer(s[k]) != n {
			t.Errorf("%s = %v want %d", k, s[k], n)
		}
	}
	if integer(s["original_income"]) != integer(s["income"])+integer(s["scope_excluded_income"])+integer(s["quarantined_income"])+integer(s["invalid_income"]) {
		t.Fatal("accounting identity")
	}
	rows = evaluate(testRows(), defaultRules(), Object{})
	if n := integer(summary(rows, "bank_statement", "2025-10-15", "2026-10-14")["income"]); n != 0 {
		t.Fatal("unconfirmed ownership counted")
	}
}
func TestRuleBoundaries(t *testing.T) {
	cases := []struct{ memo, counter, owner, want string }{{"货款", "买家", "本人", "included"}, {"现金", "柜台", "本人", "pending"}, {"结息", "银行", "本人", "excluded"}, {"贷款放款", "银行", "本人", "excluded"}, {"转入", "本人", "本人", "pending"}, {"货款", "支付宝", "本人", "pending"}}
	for _, c := range cases {
		r := standard(Object{"date": "2026-01-01", "direction": "收入", "amount": "100", "memo": c.memo, "counterparty": c.counter}, "bank_statement", 0, "test")
		r["account_holder"] = c.owner
		label, _, _ := classify(r, defaultRules())
		if label != c.want {
			t.Errorf("%s %s: %s", c.memo, c.counter, label)
		}
	}
}
func TestSourcesNeverAddTogether(t *testing.T) {
	r := standard(Object{"date": "2026-01-01", "direction": "收入", "amount": "100"}, "wechat_statement", 0, "test")
	r["document_id"] = "doc"
	rows := evaluate([]Object{r}, defaultRules(), Object{"document_scopes": Object{"doc": Object{"confirmed": true, "include": true}}})
	if integer(summary(rows, "bank_statement", "2026-01-01", "2026-01-31")["income"]) != 0 {
		t.Fatal("wallet counted as bank")
	}
}
func TestCSVAndXLSX(t *testing.T) {
	csv := []byte("date,direction,amount,counterparty,memo\n2026-01-01,收入,100.01,买家,货款\n2026-01-02,支出,5.05,商户,消费\n")
	r, e := parseFile(context.Background(), csv, "test.csv", "bank_statement", false, func(int, int) {})
	if e != nil || len(r.Rows) != 2 || integer(r.Rows[0]["income"]) != 10001 || integer(r.Rows[1]["expense"]) != 505 {
		t.Fatalf("%v %v", r, e)
	}
}
func TestVaultRejectsTampering(t *testing.T) {
	t.Setenv("MYSQL_DSN", os.Getenv("MYSQL_DSN"))
	if os.Getenv("MYSQL_DSN") == "" {
		t.Skip("requires dedicated MySQL")
	}
	s := integrationStore(t)
	path := filepath.Join(s.root, "file")
	must(s.write(path, []byte("private")))
	raw, _ := os.ReadFile(path)
	if string(raw) == "private" {
		t.Fatal("plaintext")
	}
	b, e := s.read(path)
	if e != nil || string(b) != "private" {
		t.Fatal(e)
	}
	raw[len(raw)-1] ^= 1
	os.WriteFile(path, raw, 0600)
	if _, e = s.read(path); e == nil {
		t.Fatal("tamper accepted")
	}
}
func TestQuarterSettlementAndInterestRules(t *testing.T) {
	rows := []Object{}
	for _, c := range []struct{ date, memo, amount string }{{"2026-03-20", "结息", "1.23"}, {"2026-03-21", "利息存入", "46.02"}, {"2026-03-21", "付息/", "0.57"}, {"2026-03-19", "结息", "9"}, {"2026-03-21", "货款", "100000"}} {
		r := standard(Object{"date": c.date, "memo": c.memo, "direction": "收入", "amount": c.amount}, "bank_statement", 1, "test")
		r["document_id"] = "doc"
		rows = append(rows, r)
	}
	rows = evaluate(rows, defaultRules(), Object{"document_scopes": Object{"doc": Object{"confirmed": true, "include": true}}})
	q := quarterlyInterest(rows, "2026-01-01", "2026-12-31")
	if integer(q["2026-Q1"]) != 4782 || q["2026-Q2"] != nil {
		t.Fatal(q)
	}
	if str(rows[1], "label") != "excluded" || str(rows[2], "label") != "excluded" {
		t.Fatal("deposit interest counted as business")
	}
	r := rows[0]
	r["source"] = "alipay_statement"
	if interest(r) {
		t.Fatal("wallet classified as bank interest")
	}
}
func TestLargeCentsJSONPreservesPrecision(t *testing.T) {
	v := browserJSON(Object{"income": int64(10000000000000000)}).(map[string]any)
	if v["income"] != "10000000000000000" {
		t.Fatal(v)
	}
	o := obj(`{"income":10000000000000001}`)
	if integer(o["income"]) != 10000000000000001 {
		t.Fatal("stored precision lost")
	}
}

func TestXLSXActualImport(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	head := []any{"date", "direction", "amount", "counterparty", "memo"}
	row := []any{"2026-01-01", "收入", "100.01", "合成买家", "货款"}
	must(f.SetSheetRow("Sheet1", "A1", &head))
	must(f.SetSheetRow("Sheet1", "A2", &row))
	b, e := f.WriteToBuffer()
	if e != nil {
		t.Fatal(e)
	}
	r, e := parseFile(context.Background(), b.Bytes(), "synthetic.xlsx", "bank_statement", false, func(int, int) {})
	if e != nil || len(r.Rows) != 1 || integer(r.Rows[0]["income"]) != 10001 {
		t.Fatalf("xlsx: %v %v", r, e)
	}
}
