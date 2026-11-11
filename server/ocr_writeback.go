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
	ocrDateTimeRE = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+`)
	ocrAmountRE   = regexp.MustCompile(`^[+-]?\d+(?:\.\d{1,2})?$`)
)

func parseOCRDataLine(line, source string, lineNo int) (Object, bool) {
	m := ocrDateTimeRE.FindStringSubmatch(line)
	if m == nil {
		return nil, false
	}
	rest := strings.TrimSpace(line[len(m[0]):])
	parts := strings.Fields(rest)
	if len(parts) < 2 {
		return nil, false
	}
	raw := Object{
		"交易日期": m[1],
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
