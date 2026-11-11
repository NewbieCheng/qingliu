package main

import "testing"

func TestSuggestionsFromAnalysisRequiresTransactionID(t *testing.T) {
	known := map[string]bool{"tx1": true, "tx2": true}
	result := Object{
		"anomalies": []any{
			Object{"item": "结息", "evidence": "不计入经营", "transaction_id": "tx1"},
			Object{"item": "无 id", "evidence": "跳过"},
		},
		"questions": []any{
			Object{"item": "借款待核实", "evidence": "需人工", "transaction_id": "tx2"},
			Object{"item": "陌生 id", "transaction_id": "tx9"},
		},
	}
	got := suggestionsFromAnalysis(result, known)
	if len(got) != 2 {
		t.Fatalf("len=%d want 2: %#v", len(got), got)
	}
	if str(got[0], "ai_label") != "excluded" {
		t.Fatalf("tx1 label=%q", str(got[0], "ai_label"))
	}
	if str(got[0], "ai_confidence") != "high" {
		t.Fatalf("anomaly conf=%q", str(got[0], "ai_confidence"))
	}
	if str(got[1], "ai_label") != "pending" {
		t.Fatalf("tx2 label=%q", str(got[1], "ai_label"))
	}
	if str(got[1], "ai_confidence") != "medium" {
		t.Fatalf("question conf=%q", str(got[1], "ai_confidence"))
	}
}

func TestSuggestionsFuzzyMatchByEvidence(t *testing.T) {
	known := map[string]bool{"tx-a": true}
	rows := []Object{
		{"id": "tx-a", "date": "2026-01-08", "counterparty": "结息账户", "memo": "利息", "income": int64(36), "expense": int64(0)},
	}
	result := Object{
		"anomalies": []any{
			Object{"item": "存款结息", "evidence": "2026-01-08 结息账户 利息，通常不计入经营"},
		},
	}
	got := suggestionsFromAnalysisRows(result, known, rows)
	if len(got) != 1 || str(got[0], "id") != "tx-a" {
		t.Fatalf("got=%#v", got)
	}
	if str(got[0], "ai_label") != "excluded" {
		t.Fatalf("label=%q", str(got[0], "ai_label"))
	}
}

func TestHighConfidenceSuggestedFilters(t *testing.T) {
	rows := []Object{
		{"id": "a", "ai_status": aiStatusSuggested, "ai_confidence": "high", "ai_label": "excluded"},
		{"id": "b", "ai_status": aiStatusSuggested, "ai_confidence": "medium", "ai_label": "pending"},
		{"id": "c", "ai_status": aiStatusSuggested, "ai_confidence": "high", "ai_label": "excluded", "scope_excluded": true},
		{"id": "d", "ai_status": aiStatusSuggested, "ai_confidence": "high", "ai_label": "excluded", "review_label": "included"},
		{"id": "e", "ai_status": aiStatusAdopted, "ai_confidence": "high", "ai_label": "excluded"},
	}
	got := highConfidenceSuggested(rows)
	if len(got) != 1 || str(got[0], "id") != "a" {
		t.Fatalf("got=%#v", got)
	}
}
