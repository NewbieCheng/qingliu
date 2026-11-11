package main

import (
	"strings"
)

// AI 建议状态：落在 ql_transactions.payload 的 ai_* 字段（JSON，免迁移）。
const (
	aiStatusNone       = "none"
	aiStatusSuggested  = "suggested"
	aiStatusAdopted    = "adopted"
	aiStatusOverridden = "overridden"
)

// suggestionsFromAnalysis 从整份分析结果抽出可预勾建议。
// 优先 transaction_id；没有则用 evidence/item 对已知交易的对手方/摘要/日期做弱匹配。
func suggestionsFromAnalysis(result Object, knownIDs map[string]bool) []Object {
	return suggestionsFromAnalysisRows(result, knownIDs, nil)
}

func suggestionsFromAnalysisRows(result Object, knownIDs map[string]bool, rows []Object) []Object {
	out := []Object{}
	if result == nil {
		return out
	}
	seen := map[string]bool{}
	appendItem := func(item Object, conf string) {
		tid := strings.TrimSpace(str(item, "transaction_id"))
		if tid == "" || !knownIDs[tid] {
			tid = matchSuggestionRow(item, rows, seen)
		}
		if tid == "" || !knownIDs[tid] || seen[tid] {
			return
		}
		label := guessAILabel(item)
		if label == "" {
			return
		}
		seen[tid] = true
		out = append(out, Object{
			"id":            tid,
			"ai_label":      label,
			"ai_confidence": conf,
			"ai_reason":     firstNonEmpty(str(item, "evidence"), str(item, "item")),
			"ai_locator":    firstNonEmpty(str(item, "locator"), tid),
			"ai_status":     aiStatusSuggested,
		})
	}
	for _, raw := range list(result["anomalies"]) {
		appendItem(asObject(raw), "high")
	}
	for _, raw := range list(result["questions"]) {
		appendItem(asObject(raw), "medium")
	}
	return out
}

func matchSuggestionRow(item Object, rows []Object, seen map[string]bool) string {
	if len(rows) == 0 {
		return ""
	}
	needle := normalize(str(item, "evidence") + " " + str(item, "item") + " " + str(item, "amount"))
	if needle == "" {
		return ""
	}
	var bestID string
	bestScore := 0
	for _, row := range rows {
		id := str(row, "id")
		if id == "" || seen[id] {
			continue
		}
		hay := normalize(str(row, "counterparty") + " " + str(row, "memo") + " " + str(row, "date") + " " + money(integer(row["income"])) + " " + money(integer(row["expense"])))
		score := 0
		if str(row, "date") != "" && strings.Contains(needle, normalize(str(row, "date"))) {
			score += 2
		}
		if str(row, "counterparty") != "" && strings.Contains(needle, normalize(str(row, "counterparty"))) {
			score += 3
		}
		if str(row, "memo") != "" && len([]rune(str(row, "memo"))) >= 2 && strings.Contains(needle, normalize(str(row, "memo"))) {
			score += 2
		}
		if hay != "" && strings.Contains(needle, hay) {
			score += 1
		}
		if score > bestScore {
			bestScore = score
			bestID = id
		}
	}
	if bestScore >= 3 {
		return bestID
	}
	return ""
}

func guessAILabel(item Object) string {
	text := strings.ToLower(str(item, "item") + " " + str(item, "evidence") + " " + str(item, "label"))
	explicit := strings.TrimSpace(str(item, "label"))
	switch explicit {
	case "included", "excluded", "pending", "duplicate":
		return explicit
	}
	if strings.Contains(text, "剔除") || strings.Contains(text, "Exclude") || strings.Contains(text, "不计入") ||
		strings.Contains(text, "结息") || strings.Contains(text, "提现") || strings.Contains(text, "重复") {
		if strings.Contains(text, "重复") || strings.Contains(text, "duplicate") {
			return "duplicate"
		}
		return "excluded"
	}
	if strings.Contains(text, "待核实") || strings.Contains(text, "Verify") || strings.Contains(text, "借款") {
		return "pending"
	}
	if strings.Contains(text, "Include") || strings.Contains(text, "Business") || strings.Contains(text, "货款") {
		return "included"
	}
	return "pending"
}

func asObject(v any) Object {
	if t, ok := v.(map[string]any); ok {
		return Object(t)
	}
	return Object{}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// applyAISuggestions 把建议写入交易 payload；不写 ql_reviews（正式标签仍靠人采纳）。
func (s *Store) applyAISuggestions(cid string, suggestions []Object) int {
	if len(suggestions) == 0 {
		return 0
	}
	byID := map[string]Object{}
	for _, sug := range suggestions {
		id := str(sug, "id")
		if id == "" {
			continue
		}
		byID[id] = sug
	}
	n := 0
	for _, row := range s.query("SELECT id,payload FROM ql_transactions WHERE customer_id=?", cid) {
		tid := str(row, "id")
		sug, ok := byID[tid]
		if !ok {
			continue
		}
		payload := obj(str(row, "payload"))
		payload["ai_label"] = str(sug, "ai_label")
		payload["ai_confidence"] = str(sug, "ai_confidence")
		payload["ai_reason"] = str(sug, "ai_reason")
		payload["ai_locator"] = str(sug, "ai_locator")
		payload["ai_status"] = aiStatusSuggested
		s.exec("UPDATE ql_transactions SET payload=? WHERE id=? AND customer_id=?", js(payload), tid, cid)
		n++
	}
	if n > 0 {
		s.bump(cid)
	}
	return n
}

func highConfidenceSuggested(rows []Object) []Object {
	out := []Object{}
	for _, row := range rows {
		if str(row, "ai_status") != aiStatusSuggested {
			continue
		}
		if str(row, "ai_confidence") != "high" {
			continue
		}
		if yes(row, "scope_excluded") || str(row, "quality") == "invalid" {
			continue
		}
		if str(row, "review_label") != "" {
			continue
		}
		label := str(row, "ai_label")
		if label == "" {
			continue
		}
		out = append(out, row)
	}
	return out
}
