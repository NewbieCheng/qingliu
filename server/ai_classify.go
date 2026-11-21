package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ai_classify.go —— Stage 1 CLASSIFY。
// AI 归类为主；AI 不可用时降级到唯一兜底 detectSourceFromText()。
// 加密探测是确定性的，不依赖 AI，必须先做以短路后续抽取。

// documentProbe 取前两页文字 + 页数 + 风险（加密/扫描）。仅供归类使用。
func documentProbe(ctx context.Context, name string, b []byte) (text string, pages int, risks []string) {
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".pdf" {
		// 非 PDF：取正文前缀即可（csv/xlsx 由 parseFile 正式抽取，这里只做归类线索）。
		raw := string(b)
		if len(raw) > 4000 {
			raw = raw[:4000]
		}
		return raw, 0, nil
	}
	dir, e := os.MkdirTemp("", "qingliu-probe-")
	if e != nil {
		return "", 0, nil
	}
	defer os.RemoveAll(dir)
	_ = os.Chmod(dir, 0700)
	path := filepath.Join(dir, "source.pdf")
	if e = os.WriteFile(path, b, 0600); e != nil {
		return "", 0, nil
	}
	info, combined, err := commandWithStderr(ctx, "pdfinfo", path)
	if err != nil {
		low := strings.ToLower(combined)
		if strings.Contains(low, "password") || strings.Contains(low, "encrypted") {
			risks = append(risks, "encrypted")
		}
		return "", 0, risks
	}
	_ = info
	if regexpContainsLine(string(info), "Encrypted", "yes") {
		risks = append(risks, "encrypted")
		return "", 0, risks
	}
	pages = pdfPageCount(string(info))
	// 只读前两页，归类足够，避免大文档全量抽取。
	first, err := command(ctx, "pdftotext", "-f", "1", "-l", "2", "-enc", "UTF-8", path, "-")
	if err == nil {
		t := string(first)
		if len(t) > 6000 {
			t = t[:6000]
		}
		text = t
	}
	if pages > 0 && strings.TrimSpace(text) == "" {
		risks = append(risks, "no_text_layer") // 扫描件线索
	}
	return text, pages, risks
}

// regexpContainsLine 极简判断：某行是否同时含 key 与 value（避免引 regexp）。
func regexpContainsLine(s, key, value string) bool {
	for _, line := range strings.Split(s, "\n") {
		if strings.Contains(line, key) && strings.Contains(line, value) {
			return true
		}
	}
	return false
}

func pdfPageCount(info string) int {
	lines := strings.Split(info, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Pages:") {
			return atoiSafe(strings.TrimSpace(strings.TrimPrefix(line, "Pages:")))
		}
	}
	return 0
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int(r-'0')
	}
	return n
}

// classifyPrompt 固定、简短，要求 AI 只回 JSON。
func classifyPrompt(name, text string, pages int) string {
	sample := truncateRunes(strings.TrimSpace(text), 3000)
	return strings.TrimSpace(`你是清流上传文件的归类器。只输出一个 JSON 对象，不要解释、不要代码围栏。
字段：{"doc_type":"transaction|form|credit|freeform","source":"bank_statement|wechat_statement|alipay_statement|credit_report|vat_return|other","confidence":0..1,"reason":"≤30字"}
判定：
- transaction：银行/微信/支付宝的交易明细，含交易时间、金额、收支、对手方等列。
- form：固定版式申报/表单，含"增值税及附加税费申报表""栏次""一般项目"等，是汇总数字而非逐笔交易。
- credit：征信报告。
- freeform：以上都不是。
注意：正文里出现"开户银行""某某银行账号"只是表单的一个字段，不代表它是银行流水，要综合整页判断。
文件名：` + name + `  页数：` + itoa(int64(pages)) + `
正文前两页：
` + sample)
}

type classifyResult struct {
	DocType    string  `json:"doc_type"`
	Source     string  `json:"source"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

// classifyDocument 归类：AI 主导，失败/低置信降级兜底。
func (a *App) classifyDocument(ctx context.Context, userID, name, preferred string, b []byte) (DocKind, string, []string, bool) {
	text, pages, risks := documentProbe(ctx, name, b)
	if containsString(risks, "encrypted") {
		return DocFreeform, normalizeSource(preferred), risks, false
	}

	aiFailed := false
	kind, source := DocKind(""), ""
	if a != nil && a.wb.Ready() {
		out, err := a.wbChatText(ctx, userID, classifyModel(), classifyPrompt(name, text, pages))
		if err == nil {
			var cr classifyResult
			if jsonErr := json.Unmarshal([]byte(extractJSONObject(out)), &cr); jsonErr == nil && validDocKind(cr.DocType) {
				kind = DocKind(cr.DocType)
				source = normalizeSource(cr.Source)
				if cr.Confidence < 0.75 {
					aiFailed = true // 低置信：记录，类型为 transaction 时由抽取层再核
				}
			} else {
				aiFailed = true
			}
		} else {
			aiFailed = true
		}
	} else {
		aiFailed = true
	}

	// 兜底 / 低置信：唯一启发式副本。
	if kind == "" {
		kind, source = detectSourceFromText(text, preferred)
	}
	// 表单若被兜底识别成流水，纠正为表单（申报表特征优先于"银行"）。
	if kind == DocTransaction && looksLikeForm(text) {
		kind, source = DocForm, "vat_return"
	}
	return kind, source, risks, aiFailed
}

// looksLikeForm 申报表强特征（用于兜底纠错，不依赖 AI）。
func looksLikeForm(text string) bool {
	n := normalize(text)
	return contains(n, "增值税及附加税费申报表") ||
		(contains(n, "一般纳税人适用") && contains(n, "栏次"))
}

// normalizeSource 把 AI/兜底给的业务类型映射到来源码。
func normalizeSource(s string) string {
	switch DocKind(s) {
	case DocForm:
		return "vat_return"
	}
	switch s {
	case "bank_statement", "wechat_statement", "alipay_statement", "credit_report", "vat_return":
		return s
	}
	return "other"
}

// detectSourceFromText 是旧字符串分类的**唯一保留副本**（兜底用）。
func detectSourceFromText(text, preferred string) (DocKind, string) {
	n := normalize(text)
	switch {
	case contains(n, "增值税及附加税费申报表", "一般纳税人适用") && contains(n, "栏次"):
		return DocForm, "vat_return"
	case contains(n, "微信支付交易明细"):
		return DocTransaction, "wechat_statement"
	case contains(n, "支付宝") && contains(n, "交易流水"):
		return DocTransaction, "alipay_statement"
	case contains(n, "信用报告", "征信报告"):
		return DocCredit, "credit_report"
	case contains(n, "交易时间", "交易明细") && contains(n, "金额"):
		return DocTransaction, "bank_statement"
	}
	if preferred == "other" || preferred == "" {
		return DocFreeform, "other"
	}
	if validSource(preferred) {
		return DocTransaction, preferred
	}
	return DocFreeform, "other"
}

// commandWithStderr 返回 stdout、stdout+stderr 合并文本与错误。
// 仅用于探测阶段识别 pdfinfo 的加密提示；正式解析仍走 command()。
func commandWithStderr(ctx context.Context, name string, args ...string) ([]byte, string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	e := cmd.Run()
	combined := out.String() + "\n" + errBuf.String()
	return out.Bytes(), combined, e
}

// extractJSONObject 从可能带围栏/前后缀的模型输出里抠出第一个 {...}。
func extractJSONObject(s string) string {
	s = strings.ReplaceAll(s, "```json", "")
	s = strings.ReplaceAll(s, "```", "")
	start := strings.IndexByte(s, '{')
	end := strings.LastIndexByte(s, '}')
	if start >= 0 && end > start {
		return s[start : end+1]
	}
	return s
}
