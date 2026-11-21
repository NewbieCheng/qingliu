package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	// 默认用 "auto"：网关只暴露 auto 这一个 id（/v1/models 实测），按 task_type
	// 自动路由到当前可用模型。写死 deepseek-chat 会在网关侧 404 model_not_found。
	structureRescueDefaultModel = "auto"
)

func structureRescueModel() string {
	if v := strings.TrimSpace(os.Getenv("QL_STRUCTURE_MODEL")); v != "" {
		return v
	}
	return structureRescueDefaultModel
}

// chatReasoningEffort 返回解析链路模型调用的思考等级。
// 默认 "off"（工作台接受且不转发上游，等价于关闭思考）；个别模型不接受时
// 用环境变量覆盖。空值表示完全不传该参数（由工作台注入 default_effort）。
func chatReasoningEffort() string {
	if v, ok := os.LookupEnv("QL_CHAT_REASONING"); ok {
		return strings.TrimSpace(v) // 允许设为空串 = 不传
	}
	return "off"
}

// classifyModel 是 L2 归类专用模型：归类只看摘要、要快，可用低价快模型。
// 未配置时回退到 structureRescueModel()，保持行为一致。
func classifyModel() string {
	if v := strings.TrimSpace(os.Getenv("QL_CLASSIFY_MODEL")); v != "" {
		return v
	}
	return structureRescueModel()
}

// ruleRescueThreshold：规则抽取的"可用率"低于这个值就升级到 AI 兜底。
//
// 为什么不是"零行才兜底"：线上真实情况是规则抽出了 675 行、其中 327 行
// 判 invalid（没见过的版式）。旧逻辑看到 len(Rows)>0 就直接 return，AI
// 永远不会介入，用户看到的就是"换个银行的流水就不支持了"。
//
// 0.8 的含义：允许两成的边界行（尾行、汇总行、跨页断行）规则认不出，
// 超过两成就认为是版式没覆盖，交给 AI 重新整理。
const ruleRescueThreshold = 0.8

// ruleUsability 返回规则抽取结果里"非 invalid 行"的占比（0~1）。
func ruleUsability(result *ParseResult) float64 {
	if result == nil || len(result.Rows) == 0 {
		return 0
	}
	usable := 0
	for _, t := range result.Rows {
		if str(t, "quality") != "invalid" {
			usable++
		}
	}
	return float64(usable) / float64(len(result.Rows))
}

// needsAIRescue 判断当前规则结果是否该交给 AI 兜底。
// 两个条件满足其一：完全没有行；或可用率低于阈值。
func needsAIRescue(result *ParseResult) bool {
	if result == nil {
		return false
	}
	if len(result.Rows) == 0 {
		return true
	}
	return ruleUsability(result) < ruleRescueThreshold
}

// shouldTryStructureRescueAfterOCR：规则套不上标准表，或套上了但大量无效。
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
	// 兜底需要可整理正文；没有正文（纯图片且 OCR 失败）时硬凑也没用。
	if structureRescueInput(result) == "" {
		return false
	}
	return needsAIRescue(result)
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
	// 结构化导入（CSV/XLSX/DOCX）没有 ocr_text/extract_text，但每行都带 raw
	// 原单元格文本。没有这条兜底，规则认不出的版式连"交给 AI 重排"的机会都没有。
	if b.Len() == 0 {
		for _, row := range result.Rows {
			if raw := strings.TrimSpace(str(row, "raw")); raw != "" {
				b.WriteString(raw)
				b.WriteByte('\n')
			}
		}
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

// structureRescuePrompt 让模型**直接输出结构化 JSON**，而不是"像表格的文本"。
//
// 为什么改：旧提示词要求"第一行是表头、其后每行一笔"，模型照做之后，我们还要
// 用 parseOCRTranscript 再猜一遍"哪个字段在哪一列"。这是双重转换损耗 ——
// AI 已经理解内容了，却让规则去重新猜版式；猜不中就报"没有可解析的交易行"。
//
// JSON 是**显式契约**：字段名固定，不需要猜列位置，容错空间大得多。
func structureRescuePrompt(source, raw string) string {
	preferred := source
	if preferred == "" || preferred == "other" {
		preferred = "根据内容自动判断（银行卡流水 / 微信 / 支付宝）"
	}
	return strings.TrimSpace(`你是清流上传链路的「结构化抽取」助手。把下面的资料原文转成流水明细 JSON。

只输出 JSON，不要解释、不要 Markdown 代码围栏。格式：
{"source":"bank_statement","rows":[{"date":"2026-01-05","time":"","direction":"expense","amount":"2500.00","counterparty":"杭州甲贸易","memo":"支付货款","transaction_id":""}]}

字段规则：
1. date 必须是 YYYY-MM-DD；原文是 20260105 或 2026/1/5 也要规范成这个格式。
2. direction 只能取 income / expense / neutral 三选一。
   - 原文有「收入/进账/贷方」或金额为正 → income
   - 原文有「支出/出账/借方」或金额为负 → expense
   - 明确写「不计收支/其他」→ neutral
   - 负数只表示方向，amount 里只放绝对值，不要带负号。
3. amount 只放数字（可带两位小数），不要货币符号、千分位、括号。
4. counterparty / memo / transaction_id 缺失就给空字符串，**不要编造**。
5. 原文里没有任何流水明细时，输出 {"source":"other","rows":[]}。

来源偏好：` + preferred + `。

原文：
` + raw)
}

// parseRescueJSON 从模型输出里抽出结构化流水。
//
// 模型偶尔仍会包 ```json 围栏或前后带一句话，所以这里做三级容错：
//   1. 直接当 JSON 解析
//   2. 去掉 Markdown 围栏后再解析
//   3. 截取第一个 { 到最后一个 } 再解析
func parseRescueJSON(out string) (source string, rows []Object, err error) {
	trimmed := strings.TrimSpace(out)
	if trimmed == "" {
		return "", nil, errors.New("模型未返回内容")
	}
	for _, candidate := range []string{trimmed, stripCodeFence(trimmed), bracesOnly(trimmed)} {
		if candidate == "" {
			continue
		}
		var payload struct {
			Source string   `json:"source"`
			Rows   []Object `json:"rows"`
		}
		if json.Unmarshal([]byte(candidate), &payload) == nil {
			return payload.Source, payload.Rows, nil
		}
		// 有的模型给的是数组本身
		var bare []Object
		if json.Unmarshal([]byte(candidate), &bare) == nil {
			return "", bare, nil
		}
	}
	return "", nil, errors.New("模型输出不是合法 JSON")
}

func stripCodeFence(s string) string {
	s = strings.ReplaceAll(s, "```json", "")
	s = strings.ReplaceAll(s, "```JSON", "")
	s = strings.ReplaceAll(s, "```", "")
	return strings.TrimSpace(s)
}

// bracesOnly 截取第一个 { 到最后一个 }，丢掉模型前后加的解释性文字。
func bracesOnly(s string) string {
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return ""
	}
	return s[start : end+1]
}

// rowsFromJSON 把模型给的 JSON 行转成内部交易行（补 id/quality/raw 等）。
// 这一步不做版式猜测，只做字段归一与合法性校验。
func rowsFromJSON(source string, rows []Object) []Object {
	out := make([]Object, 0, len(rows))
	for i, r := range rows {
		if r == nil {
			continue
		}
		raw := Object{
			"date":      str(r, "date"),
			"time":      str(r, "time"),
			"direction": directionWord(str(r, "direction")),
			"amount":    strings.TrimSpace(str(r, "amount")),
			"对手方":       str(r, "counterparty"),
			"摘要":        str(r, "memo"),
			"交易单号":      str(r, "transaction_id"),
		}
		row := standard(raw, source, 0, fmt.Sprintf("ai-json:%d", i+1))
		out = append(out, row)
	}
	return out
}

// directionWord 把模型给的英文档位转成 standard() 认识的中文方向词。
func directionWord(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "income", "in", "credit":
		return "收入"
	case "expense", "out", "debit":
		return "支出"
	case "neutral", "none", "other":
		return "不计收支"
	default:
		return strings.TrimSpace(s)
	}
}

// wbChatText 调用工作台 Responses API，返回助手纯文本（计费由工作台完成）。
//
// 已从 /v1/chat/completions 迁移到 /v1/responses：Responses 是后端的统一出口，
// 也是唯一能表达「嵌套 reasoning + max_output_tokens」的方言。
// 参数（输出上限、思考档位）全部来自后端配置，见 wb_limits.go。
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
	maxOutput := a.wbMaxOutputTokens(ctx, userID)
	effort := a.wbReasoningEffort(ctx, userID)
	body := responsesBody(model, prompt, false, maxOutput, effort)

	status, data, err := a.wbChat(ctx, userID, http.MethodPost, "/v1/responses", body)
	if err != nil {
		return "", err
	}
	if status == http.StatusBadRequest && effort != "" {
		// 不同模型对思考档位的兼容性不同：去掉 reasoning 重试一次。
		status, data, err = a.wbChat(ctx, userID, http.MethodPost, "/v1/responses",
			responsesBody(model, prompt, false, maxOutput, ""))
		if err != nil {
			return "", err
		}
	}
	if status < 200 || status >= 300 {
		if se := wbStatusError(status, data); se != nil {
			return "", se
		}
		return "", errors.New(wbMessage(data, "结构化补救调用失败"))
	}
	if responsesTruncated(data) {
		return "", &WBError{Code: wbErrTruncated, Message: "输出被模型上限截断，请缩小资料范围或重试"}
	}
	text := responsesText(data)
	if text == "" {
		return "", errors.New("结构化补救返回空文本")
	}
	return text, nil
}

// applyStructureRescueResult 采纳模型结果。
//
// 路径优先级（这就是"OCR 文本跟后面流程不匹配时怎么办"的答案）：
//   1. 模型按新契约给出 JSON  → 直接反序列化，不做版式猜测（首选）
//   2. JSON 不可用 → 退回旧的"表格文本"解析（兼容老模型/老提示词）
//   3. 两条都不行 → 返回明确原因，由上层给用户可操作的建议
func applyStructureRescueResult(result *ParseResult, transcript string) error {
	if result == nil {
		return errors.New("nil ParseResult")
	}
	transcript = strings.TrimSpace(transcript)
	if transcript == "" || strings.EqualFold(transcript, "UNPARSEABLE") {
		return errors.New("模型未能整理出流水明细")
	}
	preferred := str(result.Meta, "source")

	// ① 先按 JSON 契约解析
	var source string
	var rows []Object
	jsonSource, jsonRows, jsonErr := parseRescueJSON(transcript)
	if jsonErr == nil {
		src := jsonSource
		if src == "" || src == "other" {
			src = preferred
		}
		if src == "" {
			src = "bank_statement"
		}
		source, rows = src, rowsFromJSON(src, jsonRows)
	}
	// ② JSON 不可用才退回表格文本解析
	if len(rows) == 0 {
		cleaned := strings.ReplaceAll(transcript, "```", "")
		cleaned = strings.TrimSpace(cleaned)
		var fallbackErr error
		source, rows, fallbackErr = parseOCRTranscript(cleaned, preferred)
		if fallbackErr != nil {
			if jsonErr != nil {
				// 两条路都失败：把真正的失败原因带出去，别只说"没有可解析的交易行"。
				return fmt.Errorf("模型既未给出结构化 JSON（%v），转写也无法按表格解析（%v）", jsonErr, fallbackErr)
			}
			return fallbackErr
		}
	}
	// 只有 AI 结果**确实更好**才采纳：规则已经认出大部分行时，
	// 不能因为 AI 少认了一半就把它覆盖掉。这是兜底的安全阀。
	if len(result.Rows) > 0 && ruleUsability(result) >= ruleRescueThreshold && len(rows) <= len(result.Rows) {
		return errors.New("模型结果不如现有规则结果，保留原结果")
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
	if a == nil || !a.wb.Ready() {
		log.Printf("structure-rescue skip: app/wb not ready file=%s", str(payload, "name"))
		return
	}
	if !shouldTryStructureRescueAfterOCR(payload, result) {
		if result != nil {
			log.Printf("structure-rescue skip: gate closed file=%s rows=%d usability=%.2f", str(payload, "name"), len(result.Rows), ruleUsability(result))
		}
		return
	}
	raw := structureRescueInput(result)
	if raw == "" {
		log.Printf("structure-rescue skip: empty input file=%s", str(payload, "name"))
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
		// 兜底失败的原因必须进入 issues：Stage 4 会把它交给 AI 导诊，
		// 翻译成用户看得懂的话。只写日志用户就永远不知道发生了什么。
		result.Meta["issues"] = appendStrings(result.Meta["issues"], "AI 结构化兜底调用失败："+err.Error())
		result.Meta["rescue_failed"] = err.Error()
		return
	}
	if err := applyStructureRescueResult(result, out); err != nil {
		log.Printf("qingliu upload structure-rescue unusable: file=%s err=%v", str(payload, "name"), err)
		// 同上：让"模型输出了但用不上"这件事也能被翻译给用户，
		// 而不是只留一句笼统的"部分交易字段无效"。
		result.Meta["issues"] = appendStrings(result.Meta["issues"], "AI 未能整理出可用的流水明细："+err.Error())
		result.Meta["rescue_failed"] = err.Error()
		return
	}
	log.Printf("qingliu upload structure-rescue ok: file=%s rows=%d", str(payload, "name"), len(result.Rows))
}
