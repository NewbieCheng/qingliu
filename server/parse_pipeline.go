package main

import (
	"context"
	"strings"
)

// parse_pipeline.go —— 解析链路「单一主干」。
//
// 所有上传文件都走唯一入口 parseDocument()，返回统一结果契约 ParseOutcome：
//
//   Stage 1 CLASSIFY  AI 归类（doc_type + source + risks），AI 不可用时降级到唯一兜底启发式
//   Stage 2 EXTRACT   按 doc_type 分发到唯一处理器（表单模板 / 现有 parseFile 抽取引擎）
//   Stage 3 VERIFY    AI 裁判 + 硬校验 → verdict(ok/suspect/fail)
//   Stage 4 PRESENT   导诊文案 what/why/actions（失败或存疑时）
//
// 设计约束（见 docs/计划-解析链路修复与AI参与+本地自动化测试准备.md §2）：
//   - 一个入口、一种结果契约、类型驱动分发；
//   - 旧字符串分类收敛为唯一兜底 detectSourceFromText()；
//   - 旧 parseFile 坐标解析保留为唯一抽取引擎/兜底副本，不在此重建；
//   - AI 只出 suggestion/verdict，不改金额、不碰资金/权限最终裁决。

// DocKind 是文档类型（决定走哪个处理器）。
type DocKind string

const (
	DocTransaction DocKind = "transaction" // 银行/微信/支付宝流水
	DocForm        DocKind = "form"        // 固定版式表单（增值税申报表等）
	DocCredit      DocKind = "credit"      // 征信报告
	DocFreeform    DocKind = "freeform"    // 其他/杂文档，走通用解析
)

func validDocKind(s string) bool {
	switch DocKind(s) {
	case DocTransaction, DocForm, DocCredit, DocFreeform:
		return true
	}
	return false
}

// Verdict 是质检裁判结论。
type Verdict string

const (
	VerdictOK      Verdict = "ok"
	VerdictSuspect Verdict = "suspect"
	VerdictFail    Verdict = "fail"
)

// Check 是逐项质检结果。
type Check struct {
	Field      string  `json:"field"`
	Status     string  `json:"status"` // ok | fail | suspect
	Page       int     `json:"page,omitempty"`
	Note       string  `json:"note"`
	Confidence float64 `json:"confidence,omitempty"`
}

// Action 是导诊给用户的可点动作。
type Action struct {
	Label  string `json:"label"`
	Action string `json:"action"` // reparse | upload_new | use_tool | decrypt_reupload
	Hint   string `json:"hint"`
}

// Explain 是给用户的人话导诊。
type Explain struct {
	What    string   `json:"what"`
	Why     string   `json:"why"`
	Actions []Action `json:"actions"`
}

// ParseOutcome 是整条主干唯一的结果契约。
// Result 复用现有 ParseResult，保证入库/计费/旧调用方零改动。
type ParseOutcome struct {
	DocType DocKind
	Source  string // 归一化后的来源码（bank_statement / vat_return / ...）
	Result  ParseResult
	Verdict Verdict
	Checks  []Check
	Explain Explain
	// Risks 是归类阶段发现的风险（encrypted / scanned / no_text_layer）。
	Risks []string
	// AIFailed 表示归类/裁判阶段 AI 不可用，已走兜底（可观测、可统计 AI 覆盖率）。
	AIFailed bool
}

// parseDocument 是上传链路唯一解析入口。worker.go 只调它。
//
// app 允许为 nil（纯本地/测试），此时 classify/verify/explain 全部走兜底，
// 行为与改造前的 parseFile 一致，保证现有测试不回归。
func (a *App) parseDocument(
	ctx context.Context,
	userID string,
	payload Object,
	b []byte,
	progress func(int, int),
) (ParseOutcome, error) {
	name := str(payload, "name")
	preferred := str(payload, "source")

	// Stage 1 —— CLASSIFY
	kind, source, risks, aiFailed := a.classifyDocument(ctx, userID, name, preferred, b)
	outcome := ParseOutcome{
		DocType:  kind,
		Source:   source,
		Risks:    risks,
		Verdict:  VerdictOK,
		AIFailed: aiFailed,
		Checks:   []Check{},
	}
	// 加密件在抽取前就被拦下（导诊文案由 present 阶段补）。
	if containsString(risks, "encrypted") {
		outcome.DocType = DocFreeform
		outcome.Source = source
		outcome.Verdict = VerdictFail
		outcome.Result = ParseResult{Meta: Object{
			"source": source, "status": "failed", "method": "encrypted",
			"pages": 0, "rows": 0, "facts": []Object{}, "issues": []string{},
		}}
		outcome.Explain = a.explainIssue(ctx, userID, "DOC_ENCRYPTED", "文件已加密，需要打开密码", kind, 0)
		return outcome, nil
	}

	// Stage 2 —— EXTRACT（按类型分发到唯一处理器）
	var result ParseResult
	var err error
	switch kind {
	case DocForm:
		result, err = a.extractForm(ctx, name, b, source, progress)
	default:
		// transaction / credit / freeform 都复用现有抽取引擎（唯一副本 + 兜底）。
		// 传入已归一化的 source，避免 parseFile 内旧分类再误判。
		result, err = parseFile(ctx, b, name, source, progress)
	}
	if err != nil {
		return outcome, err
	}
	outcome.Result = result

	// OCR 增强沿用既有逻辑（唯一副本，不重建）。
	if a != nil && a.wb.Ready() && kind != DocForm {
		a.tryEnhanceScanWithWorkbenchOCR(ctx, userID, payload, b, &outcome.Result, nil)
	}

	// Stage 3 —— VERIFY（AI 裁判 + 硬校验）
	outcome.Verdict, outcome.Checks = a.verifyOutcome(ctx, userID, name, kind, outcome.Result)

	// Stage 4 —— PRESENT（失败/存疑才出导诊文案）
	if outcome.Verdict != VerdictOK || str(outcome.Result.Meta, "status") != "success" {
		code := "PARSE_INCOMPLETE"
		if len(outcome.Result.Rows) == 0 && kind == DocTransaction {
			code = "NO_TRANSACTION_HEADER"
		}
		outcome.Explain = a.explainIssue(ctx, userID, code,
			strings.Join(strListFromIssues(outcome.Result.Meta["issues"]), "；"), kind,
			int(integer(outcome.Result.Meta["pages"])))
	}
	return outcome, nil
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func strListFromIssues(v any) []string {
	switch list := v.(type) {
	case []string:
		return list
	case []any:
		out := make([]string, 0, len(list))
		for _, item := range list {
			out = append(out, text(item))
		}
		return out
	}
	return nil
}
