package main

import "testing"

// 进度条是展示用，但必须真实反映页进度：不能在首页就 100%，也不能在最后一页
// 停在低位。这两条规则是用户“等待焦虑”体验的核心。
func TestParsePercentStaysInsideParseBand(t *testing.T) {
	cases := []struct {
		page, total, want int
	}{
		{1, 1, 95},
		{1, 129, 5},
		{2, 129, 6},
		{65, 129, 50},
		{129, 129, 95},
		{0, 0, 10},
	}
	for _, tc := range cases {
		if got := parsePercent(tc.page, tc.total); got != tc.want {
			t.Fatalf("parsePercent(%d,%d) = %d, want %d", tc.page, tc.total, got, tc.want)
		}
	}
}

func TestAnalyzeStageProgressIsMonotonic(t *testing.T) {
	stages := []string{"uploading", "creating", "queued", "running", "summarizing", "done"}
	last := -1
	for _, stage := range stages {
		progress, label := analyzeStageProgress(stage)
		if label == "" {
			t.Fatalf("stage %s has no label", stage)
		}
		if progress < last {
			t.Fatalf("stage %s progress %d went backwards from %d", stage, progress, last)
		}
		if progress >= 100 && stage != "done" {
			t.Fatalf("stage %s reported %d%% before completion", stage, progress)
		}
		last = progress
	}
	if progress, _ := analyzeStageProgress("done"); progress != 100 {
		t.Fatalf("done progress = %d", progress)
	}
}

func TestLoginModeName(t *testing.T) {
	if loginModeName(2) != "enterprise" {
		t.Fatal("team login must map to enterprise")
	}
	if loginModeName(1) != "personal" || loginModeName(0) != "personal" {
		t.Fatal("default login must map to personal")
	}
}
