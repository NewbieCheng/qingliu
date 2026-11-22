package main

import (
	"strings"
	"testing"
)

func TestUniqueNonEmpty(t *testing.T) {
	got := uniqueNonEmpty([]string{" a ", "", "a", "b", "b"})
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("uniqueNonEmpty() = %#v", got)
	}
}

func TestAnalysisSummaryForMergeFallsBack(t *testing.T) {
	got := analysisSummaryForMerge(Object{
		"anomalies": []any{Object{"x": 1}, Object{"y": 2}},
		"questions": []any{Object{"q": 1}},
	})
	if got == "" {
		t.Fatal("expected fallback summary")
	}
	if !strings.Contains(got, "异常点 2") {
		t.Fatalf("unexpected fallback: %s", got)
	}
}

func TestPersonMergePromptMentionsCrossChannel(t *testing.T) {
	prompt := personMergePrompt([]string{"【来源1】摘要A", "【来源2】摘要B"})
	for _, part := range []string{"同人合并解读", "跨渠道", "摘要A", "摘要B"} {
		if !strings.Contains(prompt, part) {
			t.Fatalf("prompt missing %q: %s", part, prompt)
		}
	}
}
