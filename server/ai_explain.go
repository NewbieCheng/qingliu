package main

import (
	"context"
	"encoding/json"
	"strings"
)

// ai_explain.go —— Stage 4 PRESENT：把技术错误翻译成人话 + 可点动作。
// AI 不可用/调用失败时用固定兜底模板，保证任何失败都有解决出路。

func explainPrompt(code, technical string, kind DocKind, pages int) string {
	return strings.TrimSpace(`你是清流上传导诊助手。用户上传文件解析遇到问题，把技术错误翻译成人话并给可执行出路。
只输出 JSON，不要解释、不要代码围栏：
{"what":"一句话说清出了什么问题(≤30字)","why":"为什么会这样(≤40字)","actions":[{"label":"按钮文字","action":"reparse|upload_new|use_tool|decrypt_reupload","hint":"点了之后会发生什么(≤20字)"}]}
要求：不堆术语、不甩锅、至少给一条出路；action 只能取上面四种。
错误码：` + code + `
技术诊断：` + truncateRunes(technical, 400) + `
文件类型：` + string(kind) + `  页数：` + itoa(int64(pages)))
}

type explainResult struct {
	What    string   `json:"what"`
	Why     string   `json:"why"`
	Actions []Action `json:"actions"`
}

func (a *App) explainIssue(ctx context.Context, userID, code, technical string, kind DocKind, pages int) Explain {
	if a != nil && a.wb.Ready() {
		out, err := a.wbChatText(ctx, userID, structureRescueModel(), explainPrompt(code, technical, kind, pages))
		if err == nil {
			var er explainResult
			if e := json.Unmarshal([]byte(extractJSONObject(out)), &er); e == nil && strings.TrimSpace(er.What) != "" {
				if len(er.Actions) == 0 {
					er.Actions = explainFallbackActions(code)
				}
				return Explain{What: er.What, Why: er.Why, Actions: er.Actions}
			}
		}
	}
	return explainFallback(code, technical, kind)
}

func explainFallbackActions(code string) []Action {
	switch code {
	case "DOC_ENCRYPTED":
		return []Action{{Label: "解密后重传", Action: "decrypt_reupload", Hint: "在本地去掉密码再上传"}}
	case "NO_TRANSACTION_HEADER":
		return []Action{
			{Label: "改来源重解析", Action: "reparse", Hint: "手动选对资料类型重跑"},
			{Label: "用解析工具", Action: "use_tool", Hint: "自定义想提取的内容"},
		}
	default:
		return []Action{
			{Label: "重新识别", Action: "reparse", Hint: "换方式再解析一次"},
			{Label: "用解析工具", Action: "use_tool", Hint: "自定义想提取的内容"},
		}
	}
}

func explainFallback(code, technical string, kind DocKind) Explain {
	switch code {
	case "DOC_ENCRYPTED":
		return Explain{
			What: "这份 PDF 设了打开密码，系统读不了",
			Why:  "上传的文件被密码保护，需要先解密",
			Actions: explainFallbackActions(code),
		}
	case "NO_TRANSACTION_HEADER":
		return Explain{
			What: "没认出交易表格，这份可能不是流水",
			Why:  "正文里找不到交易时间/金额的表头",
			Actions: explainFallbackActions(code),
		}
	case "PARSE_INCOMPLETE":
		if kind == DocForm {
			return Explain{
				What: "表单已解析，部分字段需核对",
				Why:  "版式特殊或个别栏次数字异常",
				Actions: []Action{{Label: "查看解析结果", Action: "use_tool", Hint: "查看并复制已抽取字段"}},
			}
		}
		return Explain{
			What: "解析完成但有部分警告，请核对",
			Why:  "部分字段未能自动确认",
			Actions: explainFallbackActions(code),
		}
	default:
		return Explain{
			What: "识别遇到问题，可重试或换方式",
			Why:  truncateRunes(technical, 40),
			Actions: explainFallbackActions(code),
		}
	}
}
