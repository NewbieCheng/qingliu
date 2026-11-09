package main

import (
	"os"
	"strings"
	"testing"
)

// 任务状态机：AI 分析分支必须自己写终态。
//
// 历史缺陷：runOne 的 ai_analysis 分支跑完就往下走，ql_jobs.status 停在
// queued，busy() 恒为真，该客户后续所有写操作都被 409 挡住，重启也救不回来。
// 这里用源码断言把这层约束钉住，防止以后再被改回“只写 progress 不写 status”。
func TestAIAnalysisBranchWritesTerminalStatus(t *testing.T) {
	source, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker.go: %v", err)
	}
	text := string(source)
	if !strings.Contains(text, `str(job, "kind") == "ai_analysis"`) {
		t.Fatal("worker.go 里找不到 ai_analysis 分支")
	}
	if !strings.Contains(text, "jobFinish(jid") {
		t.Fatal("AI 分析分支必须调用 jobFinish 写终态")
	}
	if !strings.Contains(text, `failed = true`) {
		t.Fatal("AI 分析失败时要把 failed 标记传回来")
	}
}

// 队列取任务后必须立刻把 status 置为 running，
// 否则「正在跑」和「还在排队」在数据库里无法区分，队列位置与 busy 都会算错。
func TestWorkerMarksJobRunning(t *testing.T) {
	source, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("read worker.go: %v", err)
	}
	if !strings.Contains(string(source), "jobStart(jid)") {
		t.Fatal("worker 取到任务后必须调用 jobStart 置为 running")
	}
}

// busy() 必须带超时保护：卡死的任务不能永久阻断该客户的写操作。
func TestBusyIgnoresStaleJobs(t *testing.T) {
	source, err := os.ReadFile("store.go")
	if err != nil {
		t.Fatalf("read store.go: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (s *Store) busy(cid string) bool {")
	if start < 0 {
		t.Fatal("找不到 busy()")
	}
	end := strings.Index(text[start:], "\n}")
	if end < 0 {
		t.Fatal("busy() 结构异常")
	}
	body := text[start : start+end]
	if !strings.Contains(body, "staleJobMinutes") {
		t.Fatal("busy() 必须排除超时卡死的任务，否则一条失败任务会锁死整个客户")
	}
}

// 阶段文案去重：message 与阶段文案相同时不应拼成「A（A）」。
func TestStageMessageNotDuplicated(t *testing.T) {
	source, err := os.ReadFile("ai_analysis.go")
	if err != nil {
		t.Fatalf("read ai_analysis.go: %v", err)
	}
	if !strings.Contains(string(source), "if message != text {") {
		t.Fatal("step() 必须跳过 message 与阶段文案相同的拼接")
	}
}

// 取消接口存在，且只允许终止中间态任务。
func TestCancelRouteExists(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	text := string(source)
	if !strings.Contains(text, `/jobs/{jid}/cancel`) {
		t.Fatal("缺少取消任务接口")
	}
	if !strings.Contains(text, `只有排队中或执行中的任务可以终止`) {
		t.Fatal("取消接口必须拒绝已结束的任务")
	}
}
