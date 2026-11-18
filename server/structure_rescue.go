package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// 上传链路「结构化补救」与报告页 AI 分析的边界：
//
//   上传补救：同步、只把 OCR/抽出正文整理成标准交易行，写入本次 ParseResult；
//            不创建 ql_ai_analyses，不生成摘要/异常/预勾。
//   报告页 AI：异步任务，产出收入结构/异常/核对建议，由用户主动点「智能分析」。
//
// 顺序：文字层匹配 → POST /v1/ocr → parseOCRTranscript 能解析则入库
//       → 不能再模型整理 → 仍不行才 partial。

const (
	structureRescueMaxInputRunes = 24000
	structureRescueDefaultModel  = "deepseek-chat"
)

func structureRescueModel() string {
	if v := strings.TrimSpace(os.Getenv("QL_STRUCTURE_MODEL")); v != "" {
		return v
	}
	return structureRescueDefaultModel
}

// shouldTryStructureRescueAfterOCR：OCR 已跑过（或至少有可整理正文），但仍无标准行。
func shouldTryStructureRescueAfterOCR(payload Object, result *ParseResult) bool {
	if result == nil {
		return false
	}
	source := str(result.Meta, "source")
	if source == "" {
		source = str(payload, "source")
	}
	if source == "credit_report" {
		return false
	}
	if len(result.Rows) > 0 {
		return false
	}
	return structureRescueInput(result) != ""
}

func structureRescueInput(result *ParseResult) string {
	if result == nil {
		return ""
	}
	var b strings.Builder
	// 优先用工作台 OCR 正文；没有再退回文字层抽取。
	if text := strings.TrimSpace(str(result.Meta, "ocr_text")); text != "" {
		b.WriteString(text)
		b.WriteByte('\n')
	} else if text := strings.TrimSpace(str(result.Meta, "extract_text")); text != "" {
		b.WriteString(text)
		b.WriteByte('\n')
	}
	for _, fact := range list(result.Meta["facts"]) {
		f, ok := fact.(map[string]any)
		if !ok {
			continue
		}
		text := strings.TrimSpace(str(f, "text"))
		if text == "" {
			continue
		}
		page := integer(f["page"])
		if page > 0 {
			b.WriteString("【第")
			b.WriteString(itoa(page))
			b.WriteString("页】\n")
		}
		b.WriteString(text)
		b.WriteByte('\n')
	}
	return truncateRunes(strings.TrimSpace(b.String()), structureRescueMaxInputRunes)
}

func truncateRunes(s string, max int) string {
	if max <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "\n…(截断)"
}

func structureRescuePrompt(source, raw string) string {
	preferred := source
	if preferred == "" || preferred == "other" {
		preferred = "根据正文自动判断（银行卡流水 / 微信 / 支付宝）"
	}
	return strings.TrimSpace(`你是清流上传链路的「结构化补救」助手（不是报告分析）。
任务：把下面 OCR/抽出的流水原文整理成可机器解析的明细表。
要求：
1. 只输出表格正文，不要解释、不要 Markdown 代码围栏、不要总结。
2. 第一行必须是表头，且同时含「交易时间」与「金额」或「收/支」或「收支」。
3. 其后每行一笔：日期时间、收支方向、金额、对手方、摘要（缺的列留空，不要编造）。
4. 来源偏好：` + preferred + `。
5. 若无法整理成流水明细，只输出一行：UNPARSEABLE

原文：
` + raw)
}

// wbChatText 调用工作台 /v1/chat/completions，返回助手纯文本（计费由工作台完成）。
func (a *App) wbChatText(ctx context.Context, userID, model, prompt string) (string, error) {
	if a == nil || !a.wb.Ready() {
		return "", errors.New("Workbench is not connected")
	}
	if strings.TrimSpace(prompt) == "" {
		return "", errors.New("结构化补救输入为空")
	}
	if strings.TrimSpace(model) == "" {
		model = structureRescueModel()
	}
	body := Object{
		"model": model,
		"messages": []Object{
			{"role": "user", "content": prompt},
		},
		"temperature": 0,
	}
	status, data, err := a.wbRequest(ctx, userID, http.MethodPost, "/v1/chat/completions", body)
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", errors.New(wbMessage(data, "结构化补救调用失败"))
	}
	payload := data
	if nested := sub(data, "data"); nested != nil {
		payload = nested
	}
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return "", errors.New("结构化补救未返回内容")
	}
	choice, _ := choices[0].(map[string]any)
	message := nested(choice, "message")
	text := strings.TrimSpace(str(message, "content"))
	if text == "" {
		text = strings.TrimSpace(str(choice, "text"))
	}
	if text == "" {
		return "", errors.New("结构化补救返回空文本")
	}
	return text, nil
}

func applyStructureRescueResult(result *ParseResult, transcript string) error {
	if result == nil {
		return errors.New("nil ParseResult")
	}
	transcript = strings.TrimSpace(transcript)
	if transcript == "" || strings.EqualFold(transcript, "UNPARSEABLE") {
		return errors.New("模型未能整理出流水明细")
	}
	transcript = strings.ReplaceAll(transcript, "```", "")
	transcript = strings.TrimSpace(transcript)
	preferred := str(result.Meta, "source")
	source, rows, err := parseOCRTranscript(transcript, preferred)
	if err != nil {
		return err
	}
	result.Rows = rows
	result.Meta["source"] = source
	result.Meta["rows"] = len(rows)
	result.Meta["status"] = "success"
	result.Meta["method"] = "workbench-structure"
	result.Meta["structure_transcript"] = transcript
	result.Meta["issues"] = []string{}
	return nil
}

// tryStructureRescueAfterOCR：OCR 正文套不上标准表时，用聊天模型整理成可解析明细。
func (a *App) tryStructureRescueAfterOCR(ctx context.Context, userID string, payload Object, result *ParseResult, progress func(string)) {
	if a == nil || !a.wb.Ready() || !shouldTryStructureRescueAfterOCR(payload, result) {
		return
	}
	raw := structureRescueInput(result)
	if raw == "" {
		return
	}
	if progress != nil {
		progress("OCR 正文未对齐标准行，正在结构化补救…")
	}
	source := str(result.Meta, "source")
	if source == "" {
		source = str(payload, "source")
	}
	chatCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	out, err := a.wbChatText(chatCtx, userID, structureRescueModel(), structureRescuePrompt(source, raw))
	if err != nil {
		log.Printf("qingliu upload structure-rescue failed: file=%s err=%v", str(payload, "name"), err)
		return
	}
	if err := applyStructureRescueResult(result, out); err != nil {
		log.Printf("qingliu upload structure-rescue unusable: file=%s err=%v", str(payload, "name"), err)
		return
	}
	log.Printf("qingliu upload structure-rescue ok: file=%s rows=%d", str(payload, "name"), len(result.Rows))
}
