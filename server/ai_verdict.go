package main

import (
	"context"
	"encoding/json"
	"strings"
)

// ai_verdict.go —— Stage 3 VERIFY：AI 裁判 + 硬校验。
// 硬规则（表单勾稽、行数、issues）优先；AI 只补语义判断。
// 冲突一律降级 suspect，交给人工——绝不让 AI 单方改金额或核对结论。

func verdictPrompt(name string, kind DocKind, meta Object) string {
	summary := Object{
		"status": str(meta, "status"),
		"rows":   integer(meta["rows"]),
		"issues": list(meta["issues"]),
		"method": str(meta, "method"),
		"form_verdict": str(meta, "form_verdict"),
	}
	return strings.TrimSpace(`你是清流上传解析的质检裁判。只输出 JSON，不要解释、不要围栏：
{"verdict":"ok|suspect|fail","confidence":0..1,"checks":[{"field":"项目","status":"ok|suspect|fail","note":"≤30字"}]}
判定：解析结果是否完整、自洽、可信。证据不足或矛盾一律 suspect，不要编造。
文件：` + name + `  类型：` + string(kind) + `
解析摘要：` + js(summary))
}

type verdictResult struct {
	Verdict    string  `json:"verdict"`
	Confidence float64 `json:"confidence"`
	Checks     []Check `json:"checks"`
}

// verifyOutcome 硬校验 + AI 裁判融合。
func (a *App) verifyOutcome(ctx context.Context, userID, name string, kind DocKind, result ParseResult) (Verdict, []Check) {
	checks := []Check{}
	hard := VerdictOK

	// 硬规则 1：表单勾稽
	for _, v := range list(result.Meta["form_checks"]) {
		ck, ok := v.(map[string]any)
		if !ok {
			continue
		}
		c := Check{Field: str(ck, "field"), Status: str(ck, "status"), Note: str(ck, "note")}
		checks = append(checks, c)
		if c.Status == "fail" {
			hard = VerdictSuspect
		}
	}
	// 硬规则 2：带 issues / 非 success
	if len(list(result.Meta["issues"])) > 0 || str(result.Meta, "status") != "success" {
		if hard == VerdictOK {
			hard = VerdictSuspect
		}
	}
	// 硬规则 3：交易类 0 行
	if kind == DocTransaction && len(result.Rows) == 0 {
		hard = VerdictSuspect
	}

	// AI 裁判（可选，不改硬结论，只降不升）。
	ai := VerdictOK
	if a != nil && a.wb.Ready() {
		out, err := a.wbChatText(ctx, userID, structureRescueModel(), verdictPrompt(name, kind, result.Meta))
		if err == nil {
			var vr verdictResult
			if e := json.Unmarshal([]byte(extractJSONObject(out)), &vr); e == nil {
				ai = Verdict(vr.Verdict)
				if !validVerdict(ai) {
					ai = VerdictOK
				}
				for _, c := range vr.Checks {
					checks = append(checks, c)
				}
			}
		}
	}

	// 融合策略（避免"证据不足"误判）：
	//   verdictPrompt 只送摘要、不送明细，AI 看不到 rows/form_lines 时无法核验，
	//   实测它对干净数据也会保守地全判 suspect（"仅摘要，证据不足"）。
	//   因此：suspect 只由硬规则决定；AI 仅在明确判定 fail（发现实质矛盾）时才降级。
	//   这样 AI 的"提示性 suspect"不会污染 ok，同时保留 AI 发现真错的能力。
	final := hard
	if ai == VerdictFail {
		final = VerdictFail // AI 发现实质矛盾，降级
	}
	return final, checks
}

func validVerdict(v Verdict) bool {
	return v == VerdictOK || v == VerdictSuspect || v == VerdictFail
}

func verdictRank(v Verdict) int {
	switch v {
	case VerdictFail:
		return 2
	case VerdictSuspect:
		return 1
	default:
		return 0
	}
}

func worseVerdict(a, b Verdict) Verdict {
	if verdictRank(a) >= verdictRank(b) {
		return a
	}
	return b
}
