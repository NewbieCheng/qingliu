package main

import (
	"bytes"
	"fmt"
	"github.com/go-pdf/fpdf"
	"github.com/xuri/excelize/v2"
	"html/template"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"
)

var disclaimer = "For internal screening only. Lenient figures are not bank-approved revenue; final decisions follow verified files and bank review."
var labels = map[string]string{"included": "Tentative business (unverified)", "excluded": "Excluded", "pending": "Needs review", "expense": "Expense ledger", "invalid": "Parse failed", "neutral": "Neutral (no P/L)", "duplicate": "Possible duplicate"}

func mask(s string) string {
	return regexp.MustCompile(`\d{5,}`).ReplaceAllStringFunc(s, func(v string) string { return "***" + v[len(v)-4:] })
}
func privateName(s string) string {
	r := []rune(mask(s))
	if len(r) > 1 {
		return string(r[:1]) + "***" + string(r[len(r)-1:])
	}
	return string(r)
}
func generateReport(s *Store, cid, jid string, data, p Object) error {
	rid := id()
	stage := "Draft · review incomplete"
	if str(p, "stage") == "formal" {
		stage = "正式内部初筛版本 · 非授信审批"
	}
	sum := nested(data, "summary")
	rows := data["rows"].([]Object)
	docs := data["docs"].([]Object)
	customer := nested(data, "customer")
	created := time.Now().UTC().Format(time.RFC3339)
	lines := [][2]string{{"报告状态", stage}, {"Customer code", privateName(str(customer, "name"))}, {"统计来源", str(data, "source")}, {"统计期间", str(data, "start") + " 至 " + str(data, "end")}, {"生成时间（UTC）", created}, {"操作/签发人", privateName(str(p, "operator"))}, {"Review statement", mask(str(p, "statement"))}}
	keys := [][2]string{{"Raw total inflow", "original_income"}, {"归属范围外", "scope_excluded_income"}, {"疑似重复隔离额", "quarantined_income"}, {"无效行可识别流入", "invalid_income"}, {"Current measured inflow", "income"}, {"Tentative business (unverified)", "included"}, {"Excluded", "excluded"}, {"Needs review", "pending"}, {"人工已确认经营", "confirmed_income"}, {"当前范围支出", "expense"}, {"期间分摊月均", "average"}, {"完整自然月均", "complete_month_average"}}
	for _, k := range keys {
		v := "No full calendar month"
		if sum[k[1]] != nil {
			v = money(integer(sum[k[1]])) + " 元"
		}
		lines = append(lines, [2]string{k[0], v})
	}
	lines = append(lines, [2]string{"完整自然月数", fmt.Sprint(sum["complete_month_count"])}, [2]string{"待处理疑点数", fmt.Sprint(sum["pending_count"])})
	warnings := []string{}
	for _, v := range data["problems"].([]string) {
		warnings = append(warnings, v)
	}
	for _, d := range docs {
		for _, v := range list(nested(d, "meta")["issues"]) {
			warnings = append(warnings, mask(str(d, "name"))+"："+text(v))
		}
	}
	report := excelize.NewFile()
	report.SetSheetName("Sheet1", "汇总测算")
	setRow := func(f *excelize.File, sheet string, row int, values []any) {
		cell, _ := excelize.CoordinatesToCellName(1, row)
		must(f.SetSheetRow(sheet, cell, &values))
	}
	for i, line := range lines {
		setRow(report, "汇总测算", i+1, []any{line[0], line[1]})
	}
	// Numeric cells retain exact cents; display formulas are never constructed from user input.
	_, _ = report.NewSheet("金额分")
	for i, k := range keys {
		setRow(report, "金额分", i+1, []any{k[0], sum[k[1]]})
	}
	_, _ = report.NewSheet("月度")
	setRow(report, "月度", 1, []any{"月份", "总流入（分）", "暂计（分）", "剔除（分）", "待核实（分）"})
	for i, v := range list(sum["monthly"]) {
		m, _ := v.(map[string]any)
		setRow(report, "月度", i+2, []any{m["month"], m["income"], m["included"], m["excluded"], m["pending"]})
	}
	_, _ = report.NewSheet("季度结息")
	quarters := nested(sum, "quarters")
	qq := []string{}
	for k := range quarters {
		qq = append(qq, k)
	}
	sort.Strings(qq)
	for i, k := range qq {
		setRow(report, "季度结息", i+1, []any{k, quarters[k]})
	}
	_, _ = report.NewSheet("Files & tips")
	for i, d := range docs {
		m := nested(d, "meta")
		setRow(report, "Files & tips", i+1, []any{mask(str(d, "name")), m["source"], m["status"], m["coverage"], m["rows"]})
	}
	for i, w := range warnings {
		setRow(report, "Files & tips", len(docs)+i+2, []any{w})
	}
	setRow(report, "Files & tips", len(docs)+len(warnings)+3, []any{disclaimer})
	// AI / 视觉写回只作备忘：不改上面金额公式与合计口径。
	aiNoteRow := len(docs) + len(warnings) + 4
	visionDocs := 0
	for _, d := range docs {
		if yes(nested(d, "meta"), "vision_writeback") {
			visionDocs++
		}
	}
	if visionDocs > 0 {
		setRow(report, "Files & tips", aiNoteRow, []any{fmt.Sprintf("其中 %d 份资料含视觉转写写回交易；金额仍以人工核对标签为准，AI 不改合计。", visionDocs)})
	}
	_, _ = report.NewSheet("征信候选")
	lineNo := 1
	for _, d := range docs {
		for _, v := range list(nested(d, "meta")["facts"]) {
			fact, _ := v.(map[string]any)
			setRow(report, "征信候选", lineNo, []any{mask(str(d, "name")), fact["page"], mask(str(fact, "text")), "原文/OCR候选，未自动认定"})
			lineNo++
		}
	}
	detail := excelize.NewFile()
	detail.SetSheetName("Sheet1", "Line-by-line draft")
	setRow(detail, "Line-by-line draft", 1, []any{"Date", "Time", "Source", "原件", "页码", "定位", "对手方（脱敏）", "收入（分）", "支出（分）", "分类", "规则", "Out of range", "隔离", "Memo", "确认人", "依据", "原始字段（脱敏）"})
	for i, t := range rows {
		setRow(detail, "Line-by-line draft", i+2, []any{t["date"], t["time"], t["source"], mask(str(t, "filename")), t["page"], t["locator"], privateName(str(t, "counterparty")), t["income"], t["expense"], labels[str(t, "label")], t["rule_id"], yes(t, "scope_excluded"), quarantined(t), mask(str(t, "memo")), privateName(str(t, "review_operator")), mask(str(t, "review_reason")), mask(str(t, "raw"))})
	}
	_, _ = detail.NewSheet("复核记录")
	audits := s.query("SELECT r.* FROM ql_reviews r JOIN ql_transactions t ON t.id=r.transaction_id WHERE t.customer_id=? ORDER BY r.seq", cid)
	for i, r := range audits {
		setRow(detail, "复核记录", i+1, []any{r["transaction_id"], r["label"], privateName(str(r, "operator")), mask(str(r, "reason")), r["created"]})
	}
	rb, e := report.WriteToBuffer()
	if e != nil {
		return e
	}
	defer report.Close()
	db, e := detail.WriteToBuffer()
	if e != nil {
		return e
	}
	defer detail.Close()
	tmpl := template.Must(template.New("report").Parse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>清流内部初筛报告</title><style>body{font:15px/1.8 sans-serif;max-width:900px;margin:40px auto;color:#183332}h1{border-bottom:3px solid #167466}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;text-align:left;padding:8px}th{width:38%}.note{background:#f3f5f4;padding:16px} @media print{body{margin:0}}</style><h1>清流 · 客户资料与流水初筛</h1><table>{{range .Lines}}<tr><th>{{index . 0}}</th><td>{{index . 1}}</td></tr>{{end}}</table><h2>资料质量与未完成事项</h2>{{range .Warnings}}<p>{{.}}</p>{{else}}<p>当前未发现流程阻断项；资料真实性仍须人工核实。</p>{{end}}<p class="note">{{.Disclaimer}}<br>期间分摊月均按选择范围涉及月份计算；完整自然月均只统计完整自然月。不年化。微信、支付宝与银行卡分别统计。</p></html>`))
	var html bytes.Buffer
	if e = tmpl.Execute(&html, Object{"Lines": lines, "Warnings": warnings, "Disclaimer": disclaimer}); e != nil {
		return e
	}
	font := os.Getenv("PDF_FONT")
	if font == "" {
		font = "fonts/NotoSansSC.ttf"
	}
	pdf := fpdf.New("P", "mm", "A4", filepath.Dir(font))
	pdf.AddUTF8Font("zh", "", filepath.Base(font))
	pdf.AddPage()
	pdf.SetFont("zh", "", 16)
	pdf.MultiCell(0, 10, "清流 · 客户资料与流水初筛", "", "L", false)
	pdf.SetFont("zh", "", 10)
	for _, line := range lines {
		pdf.MultiCell(0, 7, line[0]+"："+line[1], "", "L", false)
	}
	pdf.Ln(4)
	for _, w := range warnings {
		pdf.MultiCell(0, 6, "待核对："+w, "", "L", false)
	}
	pdf.Ln(4)
	pdf.MultiCell(0, 6, disclaimer+"\n期间分摊月均与完整自然月均分别列示，不年化；各来源分别统计。", "", "L", false)
	var pb bytes.Buffer
	if e = pdf.Output(&pb); e != nil {
		return fmt.Errorf("PDF生成失败，请检查中文字体: %w", e)
	}
	files := map[string][]byte{"summary.xlsx": rb.Bytes(), "detail.xlsx": db.Bytes(), "report.html": html.Bytes(), "report.pdf": pb.Bytes()}
	shas := Object{}
	folder := filepath.Join(s.root, "reports", cid, rid)
	for name, b := range files {
		if e = s.write(filepath.Join(folder, name), b); e != nil {
			return e
		}
		shas[name] = hash(b)
	}
	payload := Object{"stage": p["stage"], "operator": p["operator"], "statement": p["statement"], "created": created, "revision": p["revision"], "source": data["source"], "start": data["start"], "end": data["end"], "summary": sum, "sha256": shas}
	_, e = s.db.Exec("INSERT INTO ql_reports(id,customer_id,job_id,payload) VALUES(?,?,?,?)", rid, cid, jid, js(payload))
	return e
}
