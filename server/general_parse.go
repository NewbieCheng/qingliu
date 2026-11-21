package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
)

// unmarshalJSONObject 从可能带围栏/前后缀的模型输出里解析 JSON 到目标结构。
func unmarshalJSONObject(raw string, dst any) error {
	return json.Unmarshal([]byte(extractJSONObject(raw)), dst)
}

// general_parse.go —— L3 「未知文档」的通用解析工具（按需 AI）。
//
// 与五层模型一致：
//   - 正文来自已存 payload（L1 已抽取），不重新读整个 PDF 给 AI；
//   - 只送截断摘要（L5 同样不回传原文档）；
//   - 结果写入 payload.general_parse，不写 ql_transactions，不进流水核对。

// ParsePreset 是内置的常用解析目标预设。
type ParsePreset struct {
	ID    string
	Label string
	Hint  string
}

var parsePresets = []ParsePreset{
	{ID: "vat_summary", Label: "提取各期销售额与税额", Hint: "按期间汇总增值税申报表关键数字"},
	{ID: "bank_income", Label: "汇总流水收入并分类", Hint: "按对手方/月份汇总交易收入"},
	{ID: "key_facts", Label: "提取单据关键信息", Hint: "抽出合同/单据的字段与金额"},
	{ID: "custom", Label: "自定义", Hint: "自己描述想要的结果"},
}

func validPreset(id string) bool {
	for _, p := range parsePresets {
		if p.ID == id {
			return true
		}
	}
	return false
}

// presetInstruction 把预设翻译成模型指令（简短、明确输出结构）。
func presetInstruction(preset, question string) string {
	q := strings.TrimSpace(question)
	switch preset {
	case "vat_summary":
		return "从正文中提取每期增值税申报的销售额、销项税额、应纳税额、本期应补退税额，按期间列成表格。"
	case "bank_income":
		return "从正文中汇总交易收入，按对手方和月份分组，给出金额合计。"
	case "key_facts":
		return "从正文中提取关键字段（名称、编号、日期、金额、主体），做成键值对。"
	default:
		if q == "" {
			q = "提取正文中的关键信息并整理成表格。"
		}
		return q
	}
}

func generalParsePrompt(instruction, text string) string {
	return strings.TrimSpace(`你是清流的资料解析助手。根据正文内容完成用户指定的提取任务。
输出 JSON，不要代码围栏：
{"fields":[{"label":"字段","value":"值"}],"markdown":"用 Markdown 表格呈现的提取结果","note":"≤30字的说明"}
要求：只提取正文里真实存在的数据，不要编造；数字保留原单位。
任务：` + instruction + `
正文摘要：
` + truncateRunes(strings.TrimSpace(text), 12000))
}

type generalParseResult struct {
	Fields   []map[string]any `json:"fields"`
	Markdown string           `json:"markdown"`
	Note     string           `json:"note"`
}

// runGeneralParse 取文档正文摘要，调工作台模型，返回结构化结果。
func (a *App) runGeneralParse(ctx context.Context, userID, preset, question, text string) (Object, error) {
	return a.runGeneralParseStream(ctx, userID, preset, question, text, nil)
}

// runGeneralParseStream 是流式版本：onDelta 收到每个正文增量（可为 nil）。
// 与同步版共用同一 prompt 与解析逻辑，避免两套行为漂移。
func (a *App) runGeneralParseStream(ctx context.Context, userID, preset, question, text string, onDelta func(string)) (Object, error) {
	instruction := presetInstruction(preset, question)
	var out string
	var err error
	if onDelta == nil {
		out, err = a.wbChatText(ctx, userID, structureRescueModel(), generalParsePrompt(instruction, text))
	} else {
		out, err = a.wbChatStream(ctx, userID, structureRescueModel(), generalParsePrompt(instruction, text), func(d sseDelta) {
			if d.Content != "" {
				onDelta(d.Content)
			}
		})
	}
	if err != nil {
		log.Printf("general-parse: chat failed: %v", err)
		return nil, err
	}
	var parsed generalParseResult
	if e := unmarshalJSONObject(out, &parsed); e != nil {
		// 模型返回非 JSON 时，退化为纯文本展示，不让整次解析失败。
		return Object{"fields": []any{}, "markdown": truncateRunes(out, 8000), "note": "原始文本输出"}, nil
	}
	return Object{"fields": parsed.Fields, "markdown": parsed.Markdown, "note": parsed.Note}, nil
}

// documentText 取文档可用于解析的正文（extract_text 优先，其次 ocr_text）。
func documentText(meta Object) string {
	text := str(meta, "extract_text")
	if strings.TrimSpace(text) == "" {
		text = str(meta, "ocr_text")
	}
	return strings.TrimSpace(text)
}

// batchSummarizePrompt 把多份资料的正文拼成一次总结请求。
func batchSummarizePrompt(question string, parts []Object, budget int) string {
	var sb strings.Builder
	sb.WriteString("你是清流的资料整理助手。下面是用户选中的几份资料正文，请提炼要点。\n")
	sb.WriteString("输出 Markdown：先给「总体结论」3 条以内，再按资料分小节列出关键信息（公司/金额/日期/风险点）。\n")
	sb.WriteString("只依据正文，不要编造；缺的字段写「未记载」。\n")
	if q := strings.TrimSpace(question); q != "" {
		sb.WriteString("用户特别关注：")
		sb.WriteString(q)
		sb.WriteString("\n")
	}
	remain := budget
	for i, p := range parts {
		name := str(p, "name")
		text := documentText(obj(str(p, "payload")))
		if text == "" {
			continue
		}
		if len([]rune(text)) > remain {
			text = truncateRunes(text, remain)
		}
		remain -= len([]rune(text))
		sb.WriteString(fmt.Sprintf("\n=== 资料%d：%s ===\n%s\n", i+1, name, text))
		if remain <= 0 {
			sb.WriteString("\n（正文已达长度上限，后续资料省略）\n")
			break
		}
	}
	return sb.String()
}
