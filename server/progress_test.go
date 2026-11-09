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

// 工作台余额是嵌套在 data 里的对象。用 obj(str(data,"data")) 会把对象转成
// 字符串再解析，永远得到空 map —— 表现是「余额恒为 0，所有上传都被拦」。
func TestNestedPayloadExtractionKeepsNumbers(t *testing.T) {
	envelope := Object{"data": map[string]any{"points_balance": int64(500)}}
	payload := sub(envelope, "data")
	if payload == nil {
		t.Fatal("sub() must unwrap the nested data object")
	}
	if got := integer(payload["points_balance"]); got != 500 {
		t.Fatalf("points_balance = %d, want 500", got)
	}
	// 旧的错误写法必须确实拿不到值，证明这条测试有意义。
	if wrong := obj(str(envelope, "data")); len(wrong) != 0 {
		t.Fatalf("expected the old obj(str(...)) form to lose the payload, got %v", wrong)
	}
}

func TestParseCostFollowsConfiguredPricing(t *testing.T) {
	pricing := parsePricing{Text: 1, OCR: 2, Vision: 5}
	cases := []struct {
		method string
		pages  int
		want   int64
	}{
		{"text", 129, 1},
		{"ocr", 10, 20},
		{"vision", 3, 15},
		{"text", 0, 1},
		{"ocr", 0, 2},
		{"unknown", 5, 0},
	}
	for _, tc := range cases {
		if got := pricing.parseCost(tc.method, tc.pages); got != tc.want {
			t.Fatalf("parseCost(%s,%d) = %d, want %d", tc.method, tc.pages, got, tc.want)
		}
	}
	// 全 0 时必须免费，不能因为乘页数冒出费用。
	free := parsePricing{}
	if got := free.parseCost("vision", 100); got != 0 {
		t.Fatalf("zero pricing charged %d", got)
	}
}
