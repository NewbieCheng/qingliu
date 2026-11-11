package main

import "time"

// JobPolicy 按任务 kind 配置超时与展示轮询；协议统一，数字分类型。
// 禁止再用单一常量覆盖 upload 与百页视觉。
type JobPolicy struct {
	Kind         string
	StaleMinutes int           // 超过仍 queued/running → sweep 判 stall
	RunTimeout   time.Duration // worker 单次执行预算
	PollMS       int           // 前端建议轮询间隔（仅文档/对照；权威在前端 job-policy.js）
	LocksBusy    bool          // 是否挡住底稿写操作
}

var jobPolicies = map[string]JobPolicy{
	"upload": {
		Kind:         "upload",
		StaleMinutes: 45,
		RunTimeout:   15 * time.Minute,
		PollMS:       2500,
		LocksBusy:    true,
	},
	"report": {
		Kind:         "report",
		StaleMinutes: 30,
		RunTimeout:   8 * time.Minute,
		PollMS:       3000,
		LocksBusy:    true,
	},
	"ai_analysis": {
		Kind:         "ai_analysis",
		StaleMinutes: 90, // 对齐工作台长页视觉余量；短分析仍会被自身 timeout 先结束
		RunTimeout:   25 * time.Minute,
		PollMS:       4000,
		LocksBusy:    false,
	},
}

// jobPolicy 返回 kind 策略；未知 kind 用保守默认，避免误杀。
func jobPolicy(kind string) JobPolicy {
	if p, ok := jobPolicies[kind]; ok {
		return p
	}
	return JobPolicy{
		Kind:         kind,
		StaleMinutes: 30,
		RunTimeout:   10 * time.Minute,
		PollMS:       3000,
		LocksBusy:    false,
	}
}

// maxJobStaleMinutes 给「任意活任务」粗查用的上界（jobsLive）。
func maxJobStaleMinutes() int {
	max := 30
	for _, p := range jobPolicies {
		if p.StaleMinutes > max {
			max = p.StaleMinutes
		}
	}
	return max
}

// jobStaleSQLInterval 生成 CASE kind 分支，供 DATE_SUB INTERVAL 使用。
func jobStaleSQLInterval() string {
	return `CASE kind
 WHEN 'upload' THEN 45
 WHEN 'report' THEN 30
 WHEN 'ai_analysis' THEN 90
 ELSE 30 END`
}
