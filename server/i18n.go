package main

import (
	"net/http"
	"strings"
)

// 用户可见文案走 key；注释可以中文。
// 默认英文（en），zh 映射到中文。请求头 Accept-Language / X-Locale。

const (
	localeEN = "en"
	localeZH = "zh"
)

var i18nCatalog = map[string]map[string]string{
	localeEN: {
		"err.login_required":       "Please sign in first",
		"err.insufficient_points":  "Not enough points: AI and document parsing are billed by points. Top up and retry.",
		"err.busy":                 "This customer has a background job. Wait for it to finish.",
		"err.cancel_only_active":   "Only queued or running jobs can be cancelled",
		"err.job_missing":          "Job not found",
		"err.handle_failed":        "Something went wrong. Contact an administrator.",
		"err.db_unavailable":       "Database unavailable",
		"err.bad_request":          "Invalid request",
		"err.retry_upload_only":    "Only failed upload jobs can be retried; regenerate reports instead",
		"err.workbench_missing":    "Workbench is not connected",
		"job.upload.queued":        "Queued for parsing",
		"job.upload.starting":      "Preparing to process",
		"job.upload.parsing":       "Recognizing page {{page}} / {{total}}",
		"job.upload.done":          "Recognition complete. Confirm document ownership.",
		"job.upload.partial":       "Saved with incomplete recognition; review warnings before issuing a formal report",
		"job.report.queued":        "Waiting to generate report",
		"job.report.rendering":     "Generating PDF, Excel, and report snapshot",
		"job.retry.queued":         "Waiting to retry",
		"job.cancelled":            "Cancelled by user",
		"ai.stage.uploading":       "Uploading original to analysis service",
		"ai.stage.creating":        "Creating analysis task",
		"ai.stage.queued":          "Analysis task queued",
		"ai.stage.running":         "AI is reading and organizing transactions",
		"ai.stage.running_pct":     "AI analyzing (workbench {{pct}}%)",
		"ai.stage.summarizing":     "Summarizing analysis results",
		"ai.stage.done":            "Analysis complete",
		"ai.stage.failed":          "Analysis failed",
		"ai.stage.default":         "Preparing analysis",
		"ai.timeout":               "AI analysis timed out. Please retry later.",
		"ai.cancelled":             "Analysis cancelled",
		"ai.writeback_failed":      "Vision OCR finished, but review write-back failed: {{err}}",
		"ai.writeback_ok":          "Wrote {{n}} transactions back to review",
	},
	localeZH: {
		"err.login_required":       "请先登录",
		"err.insufficient_points":  "积分不足：AI 解析与文档解析按积分计费，请先充值再试",
		"err.busy":                 "当前客户有后台任务，请等待完成",
		"err.cancel_only_active":   "只有排队中或执行中的任务可以终止",
		"err.job_missing":          "任务不存在",
		"err.handle_failed":        "处理失败，请联系管理员",
		"err.db_unavailable":       "数据库不可用",
		"err.bad_request":          "请求格式无效",
		"err.retry_upload_only":    "仅失败的上传任务可以重试；报告请重新生成",
		"err.workbench_missing":    "尚未接入工作台",
		"job.upload.queued":        "已进入队列，等待解析",
		"job.upload.starting":      "正在准备处理",
		"job.upload.parsing":       "正在识别第 {{page}} / {{total}} 页",
		"job.upload.done":          "识别完成，请确认资料归属",
		"job.upload.partial":       "资料已保存，识别未完整通过，请核对提示；未通过的资料不能直接签发正式版本",
		"job.report.queued":        "等待生成报告",
		"job.report.rendering":     "正在生成PDF、Excel与报告快照",
		"job.retry.queued":         "等待重试",
		"job.cancelled":            "已手动终止",
		"ai.stage.uploading":       "正在上传原件到分析服务",
		"ai.stage.creating":        "正在创建分析任务",
		"ai.stage.queued":          "分析任务排队中",
		"ai.stage.running":         "AI 正在阅读并整理流水",
		"ai.stage.running_pct":     "AI 正在分析（工作台进度 {{pct}}%）",
		"ai.stage.summarizing":     "正在汇总分析结果",
		"ai.stage.done":            "分析完成",
		"ai.stage.failed":          "分析失败",
		"ai.stage.default":         "准备分析",
		"ai.timeout":               "AI 分析超时，请稍后重试",
		"ai.cancelled":             "分析已取消",
		"ai.writeback_failed":      "视觉识别已完成，但写回核对失败：{{err}}",
		"ai.writeback_ok":          "已写回 {{n}} 笔交易到核对",
	},
}

func localeFromRequest(r *http.Request) string {
	if r == nil {
		return localeEN
	}
	if raw := strings.TrimSpace(r.Header.Get("X-Locale")); raw != "" {
		return normalizeLocale(raw)
	}
	accept := strings.ToLower(r.Header.Get("Accept-Language"))
	if strings.HasPrefix(accept, "zh") || strings.Contains(accept, "zh-cn") || strings.Contains(accept, "zh-hans") {
		return localeZH
	}
	return localeEN
}

func normalizeLocale(raw string) string {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case v == "zh" || strings.HasPrefix(v, "zh"):
		return localeZH
	case v == "en" || strings.HasPrefix(v, "en"):
		return localeEN
	default:
		return localeEN
	}
}

func T(locale, key string, vars map[string]string) string {
	loc := normalizeLocale(locale)
	catalog := i18nCatalog[loc]
	if catalog == nil {
		catalog = i18nCatalog[localeEN]
	}
	template, ok := catalog[key]
	if !ok {
		if fallback, ok2 := i18nCatalog[localeEN][key]; ok2 {
			template = fallback
		} else {
			template = key
		}
	}
	if len(vars) == 0 {
		return template
	}
	out := template
	for k, v := range vars {
		out = strings.ReplaceAll(out, "{{"+k+"}}", v)
	}
	return out
}

var englishLegacyMessageKey = map[string]string{
	"Not enough points: AI and document parsing are billed by points. Top up and retry.": "err.insufficient_points",
	"This customer has a background job. Wait for it to finish.": "err.busy",
	"Only queued or running jobs can be cancelled": "err.cancel_only_active",
	"Job not found": "err.job_missing",
	"Workbench is not connected": "err.workbench_missing",
	"Queued for parsing": "job.upload.queued",
	"Preparing to process": "job.upload.starting",
	"Recognition complete. Confirm document ownership.": "job.upload.done",
	"Waiting to generate report": "job.report.queued",
	"Cancelled by user": "job.cancelled",
	"Uploading original to analysis service": "ai.stage.uploading",
	"Creating analysis task": "ai.stage.creating",
	"Analysis task queued": "ai.stage.queued",
	"AI is reading and organizing transactions": "ai.stage.running",
	"Summarizing analysis results": "ai.stage.summarizing",
	"Analysis complete": "ai.stage.done",
	"Analysis failed": "ai.stage.failed",
	"Preparing analysis": "ai.stage.default",
	"AI analysis timed out. Please retry later.": "ai.timeout",
	"Analysis cancelled": "ai.cancelled",
}

func messageKeyFor(message string) (string, bool) {
	if key, ok := legacyMessageKey[message]; ok {
		return key, true
	}
	key, ok := englishLegacyMessageKey[message]
	return key, ok
}

// localizeStoredMessage 把历史中文/英文进度句尽量映射回 key 再按 locale 输出。
func localizeStoredMessage(locale, message string) string {
	msg := strings.TrimSpace(message)
	if msg == "" {
		return msg
	}
	if translated := T(locale, msg, nil); translated != msg {
		// message 本身已是 key
		return translated
	}
	if key, ok := messageKeyFor(msg); ok {
		return T(locale, key, nil)
	}
	return msg
}

var legacyMessageKey = map[string]string{
	"请先登录":                   "err.login_required",
	"Please sign in first":   "err.login_required",
	"积分不足：AI 解析与文档解析按积分计费，请先充值再试": "err.insufficient_points",
	"当前客户有后台任务，请等待完成":           "err.busy",
	"只有排队中或执行中的任务可以终止":          "err.cancel_only_active",
	"任务不存在":                     "err.job_missing",
	"已进入队列，等待解析":                "job.upload.queued",
	"正在准备处理":                    "job.upload.starting",
	"识别完成，请确认资料归属":              "job.upload.done",
	"等待生成报告":                    "job.report.queued",
	"正在生成PDF、Excel与报告快照":        "job.report.rendering",
	"等待重试":                      "job.retry.queued",
	"已手动终止":                     "job.cancelled",
	"Cancelled by user":         "job.cancelled",
	"正在上传原件到分析服务":               "ai.stage.uploading",
	"正在创建分析任务":                 "ai.stage.creating",
	"分析任务排队中":                   "ai.stage.queued",
	"AI 正在阅读并整理流水":              "ai.stage.running",
	"正在汇总分析结果":                  "ai.stage.summarizing",
	"分析完成":                      "ai.stage.done",
	"分析失败":                      "ai.stage.failed",
	"准备分析":                      "ai.stage.default",
	"尚未接入工作台":                   "err.workbench_missing",
	"AI 分析超时，请稍后重试":             "ai.timeout",
	"分析已取消":                     "ai.cancelled",
}
