package main

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// form_template.go —— Stage 2 的「固定表单处理器」。
//
// 增值税及附加税费申报表是固定版式：表头若干标签 + 41 个编号栏次行。
// 用文字层按行正则抽取（不用 AI、不用坐标），再用表内勾稽自校验。
// 结果写入 ParseResult.Meta（最终落 ql_documents.payload），ROWS 留空——
// 表单不进 ql_transactions，不污染流水核对与收入统计。

var (
	vatLineRE = regexp.MustCompile(`^(.+?)\s+(\d{1,2}(?:=[\d+\-]+)?)\s+([-\d,\.]+|——)\s+([-\d,\.]+|——)\s+([-\d,\.]+|——)\s+([-\d,\.]+|——)\s*$`)
	vatFieldRE = map[string]*regexp.Regexp{
		"纳税人识别号": regexp.MustCompile(`纳税人识别号[（(]统一社会信用代码[）)]?[:：]?\s*([A-Za-z0-9]+)`),
		"纳税人名称":   regexp.MustCompile(`纳税人名称[:：]\s*([^\s]+)`),
		"所属行业":    regexp.MustCompile(`所属行业[:：]\s*([^\s]+)`),
		"登记注册类型":  regexp.MustCompile(`登记注册类型\s+([^\s]+)`),
		"所属行业2":   regexp.MustCompile(`所属行业：([^\s]+)`),
		"税款所属期间":  regexp.MustCompile(`税款所属时间[:：]\s*自?\s*(\d{4}年\d{1,2}月\d{1,2}日)\s*至\s*(\d{4}年\d{1,2}月\d{1,2}日)`),
		"填表日期":    regexp.MustCompile(`填表日期[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)`),
	}
)

type vatLine struct {
	Item     string `json:"item"`
	No       string `json:"no"`
	GeneralM string `json:"general_month"`   // 一般项目·本月数
	GeneralY string `json:"general_year"`    // 一般项目·本年累计
	RefundM  string `json:"refund_month"`    // 即征即退·本月数
	RefundY  string `json:"refund_year"`     // 即征即退·本年累计
}

// extractForm 抽取固定表单。返回 ParseResult.Rows 恒为空。
func (a *App) extractForm(ctx context.Context, name string, b []byte, source string, progress func(int, int)) (ParseResult, error) {
	// 复用现有 PDF 文字层抽取流程拿到干净逐行文本：调用 parseFile 但不入库、只取 extract_text。
	// parseFile 对表单会走 text-layer 分支，0 行但 extract_text 完整（线上已验证）。
	parsed, err := parseFile(ctx, b, name, "other", progress)
	if err != nil {
		return ParseResult{}, err
	}
	text := str(parsed.Meta, "extract_text")
	if strings.TrimSpace(text) == "" {
		return ParseResult{}, fmt.Errorf("表单没有可抽取的文字层")
	}
	// extract_text 带【第N页】标记，去掉后按行处理。
	text = regexp.MustCompile(`【第\d+页】`).ReplaceAllString(text, "")

	header := Object{}
	for key, re := range vatFieldRE {
		if key == "所属行业2" {
			continue
		}
		m := re.FindStringSubmatch(text)
		if len(m) > 1 {
			header[key] = strings.TrimSpace(m[1])
			if key == "税款所属期间" && len(m) > 2 {
				header["税款所属期间"] = m[1] + " 至 " + m[2]
			}
		}
	}

	lines := make([]vatLine, 0, 41)
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		m := vatLineRE.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		lines = append(lines, vatLine{
			Item: strings.TrimSpace(m[1]), No: m[2],
			GeneralM: m[3], GeneralY: m[4], RefundM: m[5], RefundY: m[6],
		})
	}

	checks := vatCrossChecks(lines)
	status := "success"
	issues := []string{}
	verdict := "ok"
	if len(lines) < 30 {
		status = "partial"
		verdict = "suspect"
		issues = append(issues, fmt.Sprintf("仅抽取到 %d 个栏次（预期约 41），请核对原件", len(lines)))
	}
	for _, c := range checks {
		if c.Status != "ok" {
			status = "partial"
			verdict = "suspect"
			issues = append(issues, c.Note)
		}
	}

	meta := Object{
		"source":       source,
		"status":       status,
		"method":       "form-template",
		"doc_type":     "form",
		"pages":        parsed.Meta["pages"],
		"rows":         0,
		"facts":        []Object{},
		"issues":       issues,
		"form_kind":    "vat_return",
		"form_header":  header,
		"form_lines":   lines,
		"form_checks":  checks,
		"form_verdict": verdict,
		"extract_text": truncateRunes(text, structureRescueMaxInputRunes),
	}
	return ParseResult{Meta: meta, Rows: []Object{}}, nil
}

// vatCrossChecks 用表内勾稽关系自校验（正文中栏次号如 19=11-18）。
func vatCrossChecks(lines []vatLine) []Check {
	byNo := map[string]vatLine{}
	for _, l := range lines {
		key := strings.Split(l.No, "=")[0]
		byNo[key] = l
	}
	num := func(s string) (float64, bool) {
		s = strings.ReplaceAll(s, ",", "")
		if s == "" || s == "——" || s == "-" {
			return 0, false
		}
		v, e := strconv.ParseFloat(s, 64)
		return v, e == nil
	}
	checks := []Check{}
	add := func(field, a, b, c string, label string) {
		av, aok := num(a)
		bv, bok := num(b)
		cv, cok := num(c)
		ck := Check{Field: field, Status: "ok", Note: label + " 勾稽通过"}
		if aok && bok && cok {
			if diff := av + bv - cv; diff > 0.01 || diff < -0.01 {
				ck.Status = "fail"
				ck.Note = fmt.Sprintf("%s 勾稽不符：%.2f+%.2f≠%.2f", label, av, bv, cv)
			}
		} else {
			ck.Status = "suspect"
			ck.Note = label + " 含不可解析值，跳过勾稽"
		}
		checks = append(checks, ck)
	}
	// 24 = 19 + 21 - 23（一般项目·本月数）
	if l19, ok19 := byNo["19"]; ok19 {
		if l21, ok21 := byNo["21"]; ok21 {
			if l23, ok23 := byNo["23"]; ok23 {
				if l24, ok24 := byNo["24"]; ok24 {
					av, _ := num(l19.GeneralM)
					bv, _ := num(l21.GeneralM)
					cv, _ := num(l23.GeneralM)
					dv, _ := num(l24.GeneralM)
					ck := Check{Field: "栏次24 应纳税额合计", Status: "ok", Note: "24=19+21-23 勾稽通过"}
					if diff := av + bv - cv - dv; diff > 0.01 || diff < -0.01 {
						ck.Status = "fail"
						ck.Note = fmt.Sprintf("24=19+21-23 不符：%.2f+%.2f-%.2f≠%.2f", av, bv, cv, dv)
					}
					checks = append(checks, ck)
				}
			}
		}
	}
	_ = add // 保留通用勾稽模板，供后续扩展其他栏次
	return checks
}
