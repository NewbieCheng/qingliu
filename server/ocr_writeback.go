package main

import (
	"fmt"
	"regexp"
	"strings"
)

// parseOCRTranscript 把 page_ocr 转写正文拆成 standard 行。
// 认「表头行 + 空格分列」的微信/支付宝探测样与常见明细；认不出的行跳过，不猜方向。
func parseOCRTranscript(text, preferredSource string) (source string, rows []Object, err error) {
	text = strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
	if text == "" {
		return "", nil, fmt.Errorf("视觉转写没有可用文字")
	}
	// AI 常自发输出 Markdown 表格；先规整成"每行一笔"再匹配表头与行。
	text = tidyTranscript(text)
	source = detectOCRSource(text, preferredSource)
	if source == "" || source == "other" || source == "credit_report" {
		return "", nil, fmt.Errorf("未能识别流水来源，请确认转写内容含微信/支付宝/银行明细")
	}

	lines := strings.Split(text, "\n")
	headerIdx := -1
	for i, line := range lines {
		n := normalize(line)
		if strings.Contains(n, "交易时间") && (strings.Contains(n, "金额") || strings.Contains(n, "收/支") || strings.Contains(n, "收支")) {
			headerIdx = i
			break
		}
	}
	if headerIdx < 0 {
		return "", nil, fmt.Errorf("转写中未找到交易表头，无法写回核对")
	}

	for i := headerIdx + 1; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "探测标记") || strings.HasPrefix(line, "仅供") {
			break
		}
		row, ok := parseOCRDataLine(line, source, i+1)
		if !ok {
			continue
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 {
		return source, nil, fmt.Errorf("转写表头后没有可解析的交易行")
	}
	return source, rows, nil
}

func detectOCRSource(text, preferred string) string {
	n := normalize(text)
	detected := preferred
	if contains(n, "微信支付交易明细") {
		detected = "wechat_statement"
	} else if contains(n, "支付宝") && contains(n, "交易流水") {
		detected = "alipay_statement"
	} else if contains(n, "银行", "个人账户交易明细", "借记账户") {
		detected = "bank_statement"
	}
	if preferred != "" && preferred != "other" && detected != "" && preferred != detected {
		// 用户选择与内容冲突时以内容为准，避免错源写进核对。
		return detected
	}
	if detected == "" {
		return preferred
	}
	return detected
}

var (
	// 日期可以有横线也可以紧凑（20260105）；时间可省略。
	// 旧表达式强制「YYYY-MM-DD HH:MM:SS + 空格」，AI 回紧凑日期或只有日期时
	// 整份转写会被判「没有可解析的交易行」——这正是"换个格式就不支持"的来源。
	ocrDateTimeRE = regexp.MustCompile(`^(\d{4}-?\d{2}-?\d{2})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?\s+`)
	ocrAmountRE   = regexp.MustCompile(`^[+-]?\d+(?:\.\d{1,2})?$`)
)

// normalizeCompactDate 把 20260105 补成 2026-01-05；已是横线格式则原样返回。
// AI 与部分导出格式会给紧凑日期，不补齐会让整行被丢弃。
func normalizeCompactDate(s string) string {
	s = strings.TrimSpace(s)
	if len(s) == 8 {
		digits := true
		for _, r := range s {
			if r < '0' || r > '9' {
				digits = false
				break
			}
		}
		if digits {
			return s[:4] + "-" + s[4:6] + "-" + s[6:]
		}
	}
	return s
}

// tidyTranscript 把 AI 的常见输出形态规整成"每行一笔"的空格分隔文本：
//   - 去掉 Markdown 表格竖线与 |---|---| 分隔行（AI 常自发表格化）
//   - 去掉全角竖线与多余空白
//
// 不做这一步时，`| 2026-01-05 | 支出 | 2500.00 |` 这种行永远匹配不到行首日期。
func tidyTranscript(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.ReplaceAll(line, "｜", "|")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		// Markdown 对齐分隔行：|---|:--:| 之类，直接丢弃
		if strings.HasPrefix(trimmed, "|") && strings.Trim(trimmed, "|:- ") == "" {
			continue
		}
		line = strings.ReplaceAll(line, "|", " ")
		line = strings.Join(strings.Fields(line), " ")
		if line == "" {
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func parseOCRDataLine(line, source string, lineNo int) (Object, bool) {
	m := ocrDateTimeRE.FindStringSubmatch(line)
	if m == nil {
		return nil, false
	}
	rest := strings.TrimSpace(line[len(m[0]):])
	parts := strings.Fields(rest)
	// 日期单独成"段"也是合法行：日期 + 方向 + 金额 两列就够成一笔。
	if len(parts) < 2 {
		return nil, false
	}
	raw := Object{
		"交易日期": normalizeCompactDate(m[1]),
		"交易时间": m[2],
	}
	dir := ""
	amountIdx := -1
	for i, p := range parts {
		switch p {
		case "收入", "进账", "贷", "贷方":
			dir = "收入"
			continue
		case "支出", "出账", "借", "借方":
			dir = "支出"
			continue
		}
		if ocrAmountRE.MatchString(strings.ReplaceAll(p, ",", "")) {
			amountIdx = i
			raw["金额"] = strings.ReplaceAll(p, ",", "")
			if dir != "" {
				raw["收支方向"] = dir
			}
			break
		}
	}
	if amountIdx < 0 {
		return nil, false
	}
	tail := parts[amountIdx+1:]
	if len(tail) >= 1 {
		raw["对手方"] = tail[0]
	}
	if len(tail) >= 2 {
		raw["交易摘要/备注"] = strings.Join(tail[1:], " ")
	} else if len(tail) == 0 && dir != "" {
		// 无对手方时至少保留方向与金额
	}
	row := standard(raw, source, 0, fmt.Sprintf("ocr-line:%d", lineNo))
	return row, true
}

// applyOCRWriteback 把视觉转写行追加进已有资料；指纹去重，并刷新文档 meta。
func (s *Store) applyOCRWriteback(cid, docID, name string, source string, rows []Object) (int, error) {
	doc := s.one("SELECT id,name,payload FROM ql_documents WHERE id=? AND customer_id=?", docID, cid)
	if doc == nil {
		return 0, fmt.Errorf("资料不存在")
	}
	if name == "" {
		name = str(doc, "name")
	}
	tx, e := s.db.Begin()
	if e != nil {
		return 0, e
	}
	defer tx.Rollback()

	added := 0
	for _, t := range rows {
		var key any
		if str(t, "transaction_id") != "" {
			key = []any{t["source"], t["account"], t["transaction_id"]}
		} else {
			key = []any{t["source"], t["account"], t["date"], t["time"], t["income"], t["expense"], t["counterparty"], t["memo"]}
		}
		fp := hash([]byte(js(key)))
		var n int
		if e = tx.QueryRow("SELECT COUNT(*) FROM ql_transactions WHERE customer_id=? AND fingerprint=?", cid, fp).Scan(&n); e != nil {
			return 0, e
		}
		t["id"] = id()
		t["document_id"] = docID
		t["filename"] = name
		t["duplicate"] = n > 0
		t["method"] = "page-ocr-writeback"
		if _, e = tx.Exec("INSERT INTO ql_transactions(id,customer_id,document_id,fingerprint,payload) VALUES(?,?,?,?,?)", t["id"], cid, docID, fp, js(t)); e != nil {
			return 0, e
		}
		added++
	}

	meta := obj(str(doc, "payload"))
	meta["source"] = source
	meta["method"] = "page-ocr-writeback"
	meta["status"] = "success"
	meta["rows"] = integer(meta["rows"]) + int64(added)
	meta["vision_writeback"] = true
	issues := list(meta["issues"])
	filtered := []any{}
	for _, issue := range issues {
		msg := text(issue)
		if strings.Contains(msg, "视觉识别") || strings.Contains(msg, "无文字层") {
			continue
		}
		filtered = append(filtered, issue)
	}
	meta["issues"] = filtered
	if _, e = tx.Exec("UPDATE ql_documents SET payload=? WHERE id=? AND customer_id=?", js(meta), docID, cid); e != nil {
		return 0, e
	}
	if e = tx.Commit(); e != nil {
		return 0, e
	}
	s.bump(cid)
	return added, nil
}
