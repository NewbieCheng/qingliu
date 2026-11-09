package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/text/unicode/norm"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Object = map[string]any

func id() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func hash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func js(v any) string {
	b, e := json.Marshal(v)
	if e != nil {
		panic(e)
	}
	return string(b)
}
func obj(s string) Object {
	var v Object
	d := json.NewDecoder(strings.NewReader(s))
	d.UseNumber()
	_ = d.Decode(&v)
	if v == nil {
		v = Object{}
	}
	return v
}
func text(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}
func str(o Object, k string) string { return text(o[k]) }

// strList 把 JSON 数组字段（权限码快照）读成字符串切片。
//
// 宽松解析而不是要求强类型：这个值来自另一个系统（工作台）的响应，
// 形状不对时应该**降级成没有快照**（由 ql_users.role 兜底），
// 而不是让整次登录失败。
func strList(v any) []string {
	list, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		if code := strings.TrimSpace(text(item)); code != "" {
			out = append(out, code)
		}
	}
	return out
}
func integer(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	}
	return 0
}
func nested(o Object, k string) Object {
	if v, ok := o[k].(map[string]any); ok {
		return v
	}
	return Object{}
}
func yes(o Object, k string) bool { v, _ := o[k].(bool); return v }
func normalize(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(norm.NFKC.String(s)), ""))
}

var amountRE = regexp.MustCompile(`^[+-]?\d+(\.\d+)?$`)

func cents(s string) (int64, error) {
	s = strings.TrimSpace(norm.NFKC.String(s))
	s = strings.NewReplacer(",", "", "¥", "", "￥", "").Replace(s)
	if !amountRE.MatchString(s) {
		return 0, errors.New("金额格式无效")
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return 0, errors.New("金额无效")
	}
	limit := new(big.Rat).SetInt64(100000000000000)
	a := new(big.Rat).Abs(r)
	if a.Cmp(limit) > 0 {
		return 0, errors.New("金额超出范围")
	}
	a.Mul(a, big.NewRat(100, 1))
	a.Add(a, big.NewRat(1, 2))
	n := new(big.Int).Quo(a.Num(), a.Denom()).Int64()
	if r.Sign() < 0 {
		n = -n
	}
	return n, nil
}
func money(n int64) string {
	if n < 0 {
		return "-" + money(-n)
	}
	return fmt.Sprintf("%d.%02d", n/100, n%100)
}
func iso(s string) (string, error) {
	s = strings.NewReplacer("/", "-", ".", "-").Replace(strings.TrimSpace(s))
	if len(s) >= 10 {
		s = s[:10]
	}
	t, e := time.Parse("2006-01-02", s)
	return t.Format("2006-01-02"), e
}

var aliases = map[string][]string{
	"date": {"交易日期", "日期", "记账日期"}, "time": {"交易时间", "时间", "记账时间"}, "income": {"收入金额", "收入", "贷方发生额"}, "expense": {"支出金额", "支出", "借方发生额"},
	"counterparty": {"对手方", "交易对方", "对方户名", "对方账户名"}, "counter_account": {"对手账号", "对方账号", "对方卡号/账号"}, "payer": {"转出账户名称"}, "payer_account": {"转出账号(尾4)", "转出账号"}, "payee": {"转入账户名称"}, "payee_account": {"转入账号(尾4)", "转入账号"},
	"memo": {"交易摘要/备注", "摘要", "备注", "交易摘要", "交易名称"}, "channel": {"交易渠道", "渠道"}, "account": {"本方账号", "账户"}, "account_type": {"账户类型"}, "direction": {"收支方向", "方向", "收/支"}, "amount": {"金额", "交易金额"}, "transaction_id": {"交易单号", "订单号"},
}

func standard(raw Object, source string, page int, locator string) Object {
	t := Object{"source": source, "page": page, "locator": locator, "raw": js(raw), "quality": "structured", "duplicate": false}
	clean := Object{}
	for k, v := range raw {
		clean[normalize(k)] = v
	}
	for k, aa := range aliases {
		t[k] = ""
		for _, a := range append([]string{k}, aa...) {
			if v, ok := clean[normalize(a)]; ok {
				t[k] = text(v)
				break
			}
		}
	}
	fail := func(msg string) Object {
		t["quality"] = "invalid"
		t["income"] = nil
		t["expense"] = int64(0)
		t["direction"] = "unknown"
		t["error"] = msg
		if d, e := iso(str(t, "date")); e == nil {
			t["date"] = d
		} else {
			t["date"] = ""
		}
		return t
	}
	d, e := iso(str(t, "date"))
	if e != nil {
		return fail("日期无效")
	}
	t["date"] = d
	direction := map[string]string{"收入": "income", "进账": "income", "贷": "income", "贷方": "income", "income": "income", "支出": "expense", "出账": "expense", "借": "expense", "借方": "expense", "expense": "expense", "不计收支": "neutral", "其他": "neutral", "neutral": "neutral"}[normalize(str(t, "direction"))]
	var inc, exp int64
	split := strings.TrimSpace(str(t, "income")) != "" || strings.TrimSpace(str(t, "expense")) != ""
	if split {
		if strings.TrimSpace(str(t, "income")) != "" {
			inc, e = cents(str(t, "income"))
			if e != nil {
				return fail(e.Error())
			}
		}
		if strings.TrimSpace(str(t, "expense")) != "" {
			exp, e = cents(str(t, "expense"))
			if e != nil {
				return fail(e.Error())
			}
		}
		if inc < 0 || exp < 0 || (inc != 0 && exp != 0) {
			return fail("收入/支出列符号冲突")
		}
		actual := ""
		if inc != 0 {
			actual = "income"
		} else if exp != 0 {
			actual = "expense"
		}
		if actual == "" {
			return fail("零金额没有明确方向")
		}
		if direction != "" && direction != actual {
			return fail("方向字段与金额列矛盾")
		}
		direction = actual
	} else {
		amount, err := cents(str(t, "amount"))
		if err != nil || amount < 0 || direction == "" {
			return fail("方向或金额未确认")
		}
		if direction == "income" {
			inc = amount
		}
		if direction == "expense" {
			exp = amount
		}
	}
	t["income"] = inc
	t["expense"] = exp
	t["direction"] = direction
	if str(t, "counterparty") == "" {
		if direction == "income" {
			t["counterparty"] = t["payer"]
		} else {
			t["counterparty"] = t["payee"]
		}
	}
	if str(t, "counter_account") == "" {
		if direction == "income" {
			t["counter_account"] = t["payer_account"]
		} else {
			t["counter_account"] = t["payee_account"]
		}
	}
	if str(t, "account") == "" {
		if direction == "income" {
			t["account"] = t["payee_account"]
		} else {
			t["account"] = t["payer_account"]
		}
	}
	return t
}
func defaultRules() Object {
	return Object{"positive": []string{"货款", "往来款", "材料款", "加工费", "服务费", "运费", "工程款"}, "negative": []string{"提现", "理财", "基金", "保险", "存款利息", "贷款", "放款", "还款", "月供", "工资", "代发", "社保", "公积金", "借款", "拆借", "退款", "冲正", "撤销", "ATM取款", "财付通", "支付宝"}, "cash_mode": "pending", "loan_mode": "excluded", "platform_mode": "pending", "related": []Object{}, "large_cents": 10000000, "frequent_count": 20}
}
func list(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	b, _ := json.Marshal(v)
	var a []any
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.UseNumber()
	_ = d.Decode(&a)
	return a
}
func contains(s string, ws ...string) bool {
	for _, w := range ws {
		if strings.Contains(s, normalize(w)) {
			return true
		}
	}
	return false
}
func interest(t Object) bool {
	if str(t, "source") != "bank_statement" {
		return false
	}
	memo := strings.TrimSpace(str(t, "memo"))
	return !strings.Contains(memo, "利息税") && (strings.Contains(memo, "结息") || memo == "利息" || memo == "利息存入" || (strings.TrimSpace(strings.TrimRight(memo, "/")) == "付息" && integer(t["income"]) > 0))
}
func quarterlyInterest(rows []Object, start, end string) Object {
	out := Object{}
	a, _ := time.Parse("2006-01-02", start)
	b, _ := time.Parse("2006-01-02", end)
	for year := a.Year(); year <= b.Year(); year++ {
		for _, m := range []int{3, 6, 9, 12} {
			target := fmt.Sprintf("%04d-%02d-21", year, m)
			if target < start || target > end {
				continue
			}
			key := fmt.Sprintf("%d-Q%d", year, m/3)
			out[key] = nil
			var total int64
			found := false
			for _, t := range rows {
				if str(t, "source") != "bank_statement" || yes(t, "scope_excluded") || str(t, "quality") == "invalid" || quarantined(t) || !interest(t) {
					continue
				}
				day := str(t, "date")
				if day < start || day > end || len(day) != 10 || day[:7] != target[:7] || (day[8:] != "20" && day[8:] != "21") || integer(t["income"]) <= 0 {
					continue
				}
				found = true
				total += integer(t["income"])
			}
			if found {
				out[key] = total
			}
		}
	}
	return out
}

func classify(t, c Object) (string, string, string) {
	if str(t, "quality") == "invalid" || t["income"] == nil || str(t, "date") == "" {
		return "invalid", "Q01", "日期、方向或金额未确认"
	}
	if str(t, "direction") == "expense" {
		return "expense", "D01", "支出仅保留台账"
	}
	if str(t, "direction") == "neutral" {
		return "neutral", "D02", "来源标注不计收支"
	}
	if yes(t, "duplicate") {
		return "pending", "Q02", "疑似重复，确认前隔离"
	}
	if str(t, "direction") != "income" {
		return "invalid", "Q01", "未识别方向"
	}
	if interest(t) {
		return "excluded", "R03", "存款结息单列，不作为经营流入"
	}
	s := normalize(str(t, "memo") + str(t, "channel"))
	for _, v := range list(c["related"]) {
		r, _ := v.(map[string]any)
		a, n := normalize(str(r, "account")), normalize(str(r, "name"))
		if (a != "" && a == normalize(str(t, "counter_account"))) || (a == "" && n != "" && n == normalize(str(t, "counterparty"))) {
			m := str(r, "mode")
			if m != "pending" {
				m = "excluded"
			}
			return m, "R01", "人工关联名单"
		}
	}
	if str(t, "source") == "bank_statement" && str(t, "account_holder") != "" && normalize(str(t, "account_holder")) == normalize(str(t, "counterparty")) {
		return "pending", "R13", "与账户持有人同名，需核实本人转账"
	}
	groups := [][]string{{"退款", "冲正", "撤销"}, {"理财", "基金", "保险", "存款利息"}, {"贷款", "放款", "还款", "月供"}, {"工资", "代发", "社保", "公积金"}}
	for i, g := range groups {
		for _, w := range g {
			for _, n := range list(c["negative"]) {
				if normalize(text(n)) == normalize(w) && contains(s, w) {
					return "excluded", fmt.Sprintf("R%02d", i+2), "非经营类：" + w
				}
			}
		}
	}
	if contains(s, "借款", "拆借") {
		return str(c, "loan_mode"), "R06", "借款拆借"
	}
	if contains(s, "现金", "存现", "atm") {
		return str(c, "cash_mode"), "R07", "现金存现"
	}
	if contains(s, "提现") {
		return "excluded", "R08", "平台提现避免重复计入"
	}
	if str(t, "source") == "bank_statement" && contains(normalize(str(t, "counterparty"))+s, "财付通", "支付宝", "微信") {
		return str(c, "platform_mode"), "R09", "平台名称需核实资金性质"
	}
	for _, w := range list(c["negative"]) {
		if contains(s, text(w)) {
			return "pending", "R10", "自定义负向词需核实"
		}
	}
	if yes(c, "require_counterparty") && str(t, "source") == "bank_statement" && str(t, "counterparty") == "" && str(t, "counter_account") == "" {
		return "pending", "R15", "未提供对手姓名/账号"
	}
	for _, w := range list(c["positive"]) {
		if contains(s, text(w)) {
			return "included", "R11", "正向备注，暂计未核实"
		}
	}
	return "included", "R12", "宽松口径陌生进账，未核实"
}
func evaluate(rows []Object, c, fields Object) []Object {
	scopes := nested(fields, "document_scopes")
	counts := map[string]int{}
	for _, t := range rows {
		counts[str(t, "source")+"/"+str(t, "counterparty")]++
	}
	for _, t := range rows {
		scope, _ := scopes[str(t, "document_id")].(map[string]any)
		if str(t, "account_holder") == "" && yes(scope, "confirmed") {
			t["account_holder"] = scope["holder"]
		}
		label, rule, reason := classify(t, c)
		t["auto_label"] = label
		t["rule_id"] = rule
		t["reason"] = reason
		t["rule_version"] = hash([]byte(js(c)))[:12]
		t["label"] = label
		if r := str(t, "review_label"); r != "" && r != "unreviewed" && label != "invalid" {
			t["label"] = r
		}
		if str(t, "direction") != "income" && label != "invalid" && str(t, "review_label") != "duplicate" {
			t["label"] = label
		}
		t["scope_excluded"] = !yes(scope, "confirmed") || !yes(scope, "include")
		if yes(t, "scope_excluded") {
			t["scope_reason"] = "归属未确认或明确不纳入"
		}
		spouse, child := normalize(str(fields, "spouse_name")), normalize(str(fields, "child_name"))
		if spouse != "" && (normalize(str(t, "account_holder")) == spouse || normalize(str(t, "counterparty")) == spouse) {
			t["scope_excluded"] = true
			t["scope_reason"] = "剔除配偶账户或往来"
		}
		if child != "" && normalize(str(t, "account_holder")) == child {
			t["scope_excluded"] = true
			t["scope_reason"] = "子女账户单列"
		} else if child != "" && normalize(str(t, "counterparty")) == child && str(t, "direction") == "income" && str(t, "quality") != "invalid" {
			t["auto_label"] = "pending"
			t["rule_id"] = "R14"
			if str(t, "review_label") == "" {
				t["label"] = "pending"
			}
		}
		alerts := []string{}
		if integer(t["income"]) >= integer(c["large_cents"]) {
			alerts = append(alerts, "大额需核实")
		}
		if str(t, "counterparty") != "" && counts[str(t, "source")+"/"+str(t, "counterparty")] >= int(integer(c["frequent_count"])) {
			alerts = append(alerts, "高频对手方需核实")
		}
		t["alerts"] = alerts
	}
	return rows
}
func quarantined(t Object) bool {
	r := str(t, "review_label")
	return str(t, "label") == "duplicate" || (yes(t, "duplicate") && r != "included" && r != "excluded" && r != "expense" && r != "neutral")
}
func needsReview(t Object) bool {
	return !yes(t, "scope_excluded") && (str(t, "label") == "invalid" || str(t, "label") == "pending" || quarantined(t))
}
func summary(rows []Object, source, start, end string) Object {
	out := Object{}
	keys := []string{"original_income", "original_expense", "scope_excluded_income", "scope_excluded_expense", "quarantined_income", "quarantine_expense", "invalid_income", "invalid_expense", "income", "expense", "included", "excluded", "pending", "confirmed_income", "transaction_count", "invalid_count", "duplicate_count", "pending_count", "count"}
	for _, k := range keys {
		out[k] = int64(0)
	}
	add := func(k string, n int64) { out[k] = integer(out[k]) + n }
	monthly := map[string]Object{}
	a, _ := time.Parse("2006-01-02", start)
	b, _ := time.Parse("2006-01-02", end)
	for d := time.Date(a.Year(), a.Month(), 1, 0, 0, 0, 0, time.UTC); !d.After(b); d = d.AddDate(0, 1, 0) {
		m := d.Format("2006-01")
		monthly[m] = Object{"month": m, "income": int64(0), "included": int64(0), "excluded": int64(0), "pending": int64(0)}
	}
	quarter := Object{}
	if source == "bank_statement" {
		quarter = quarterlyInterest(rows, start, end)
	}
	for _, t := range rows {
		if str(t, "source") != source || str(t, "date") < start || str(t, "date") > end {
			continue
		}
		inc, exp := integer(t["income"]), integer(t["expense"])
		add("transaction_count", 1)
		add("original_income", inc)
		add("original_expense", exp)
		if yes(t, "scope_excluded") {
			add("scope_excluded_income", inc)
			add("scope_excluded_expense", exp)
			continue
		}
		if needsReview(t) {
			add("pending_count", 1)
		}
		if yes(t, "duplicate") {
			add("duplicate_count", 1)
		}
		if str(t, "quality") == "invalid" {
			add("invalid_count", 1)
			add("invalid_income", inc)
			add("invalid_expense", exp)
			continue
		}
		if quarantined(t) {
			add("quarantined_income", inc)
			add("quarantine_expense", exp)
			continue
		}
		add("expense", exp)
		if str(t, "direction") == "income" {
			add("income", inc)
			add(str(t, "label"), inc)
			m := monthly[str(t, "date")[:7]]
			if m != nil {
				m["income"] = integer(m["income"]) + inc
				m[str(t, "label")] = integer(m[str(t, "label")]) + inc
			}
			if str(t, "label") == "included" {
				add("count", 1)
			}
			if str(t, "review_label") == "included" {
				add("confirmed_income", inc)
			}
		}

	}
	ms := []string{}
	for m := range monthly {
		ms = append(ms, m)
	}
	sort.Strings(ms)
	months := []Object{}
	var complete, completeTotal int64
	for _, m := range ms {
		v := monthly[m]
		months = append(months, v)
		d, _ := time.Parse("2006-01-02", m+"-01")
		last := d.AddDate(0, 1, -1).Format("2006-01-02")
		if start <= m+"-01" && end >= last {
			complete++
			completeTotal += integer(v["included"])
		}
	}
	round := func(n, d int64) int64 {
		if d == 0 {
			return 0
		}
		return (n + d/2) / d
	}
	out["monthly"] = months
	out["month_count"] = len(ms)
	out["average"] = round(integer(out["included"]), int64(len(ms)))
	out["complete_month_count"] = complete
	out["complete_month_average"] = nil
	if complete > 0 {
		out["complete_month_average"] = round(completeTotal, complete)
	}
	out["quarters"] = quarter
	out["source"] = source
	out["start"] = start
	out["end"] = end
	out["days"] = int64(b.Sub(a).Hours()/24) + 1
	return out
}

// Preserve cents beyond JavaScript's exact integer range when sending JSON to React.
func browserJSON(v any) any {
	d := json.NewDecoder(strings.NewReader(js(v)))
	d.UseNumber()
	var decoded any
	must(d.Decode(&decoded))
	var walk func(any) any
	walk = func(v any) any {
		switch x := v.(type) {
		case json.Number:
			if n, e := x.Int64(); e == nil && (n > 9007199254740991 || n < -9007199254740991) {
				return string(x)
			}
		case map[string]any:
			for k, v := range x {
				x[k] = walk(v)
			}
		case []any:
			for i, v := range x {
				x[i] = walk(v)
			}
		}
		return v
	}
	return walk(decoded)
}

// defaultTeamTenantID 是清流默认团队「今天不加班」在工作台 t_tenant 里的主键。
// 与工作台保持一致：团队资料按这个 tenant_id 归属，个人空间用 0。
const defaultTeamTenantID = 1
