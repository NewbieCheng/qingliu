package main

// wb_stream.go —— 工作台错误分类 + 流式调用（Responses API）。
//
// 协议：POST /v1/responses
//   - 请求：{model, input, reasoning:{effort}, max_output_tokens, stream, store:false}
//   - 流式事件：response.output_text.delta（正文增量）
//               response.reasoning_summary_text.delta（思考增量，不给用户看）
//               response.completed / response.incomplete / response.failed（终帧）
//   - ⚠️ 没有 data: [DONE]！必须按事件名判断结束，否则会一直读下去。
//
// 参数来源：max_output_tokens 与思考档位一律来自 wb_limits.go（后端配置），
// 清流不写死数值（见 docs/终极改造方案-清流瘦身与能力归一.md 铁律 L1）。

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
)

// WBError 是给前端看的可诊断错误：code 决定前端提示与是否可重试。
type WBError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *WBError) Error() string { return e.Message }

// 错误码。前端按 code 显示对应文案（见 zh-CN.js / en-US.js `wb.err.*`）。
const (
	wbErrTimeout      = "timeout"
	wbErrQuota        = "quota"
	wbErrModelUnavail = "model_unavailable"
	wbErrAuth         = "auth"
	wbErrEmptyInput   = "empty_input"
	wbErrUpstream     = "upstream"
	wbErrUnknown      = "unknown"
	// wbErrTruncated 表示输出被上限截断（后端返回 incomplete + max_output_tokens）。
	wbErrTruncated = "truncated"
)

// wbTransportError 把底层网络错误翻成带 code 的 WBError。
func wbTransportError(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(msg, "Timeout exceeded") ||
		strings.Contains(msg, "context deadline exceeded") {
		return &WBError{Code: wbErrTimeout, Message: "Workbench temporarily unavailable. Please retry later."}
	}
	return &WBError{Code: wbErrUpstream, Message: "Workbench temporarily unavailable. Please retry later."}
}

// wbStatusError 按 HTTP 状态码分类。返回 nil 表示状态正常。
func wbStatusError(status int, data Object) error {
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return &WBError{Code: wbErrAuth, Message: "Please sign in to the workbench again"}
	case status == http.StatusPaymentRequired:
		return &WBError{Code: wbErrQuota, Message: "Not enough points: AI and document parsing are billed by points. Top up and retry."}
	case status == http.StatusTooManyRequests:
		return &WBError{Code: wbErrQuota, Message: "Workbench temporarily unavailable. Please retry later."}
	case status == http.StatusNotFound || status == http.StatusBadRequest:
		msg := wbMessage(data, "结构化补救调用失败")
		if strings.Contains(strings.ToLower(msg), "model") {
			return &WBError{Code: wbErrModelUnavail, Message: msg}
		}
		return &WBError{Code: wbErrUpstream, Message: msg}
	case status == http.StatusGatewayTimeout:
		return &WBError{Code: wbErrTimeout, Message: "Workbench temporarily unavailable. Please retry later."}
	default:
		return &WBError{Code: wbErrUpstream, Message: wbMessage(data, "结构化补救调用失败")}
	}
}

// sseDelta 是从上游流里抽出来的增量。
type sseDelta struct {
	Content   string
	Reasoning string
	Done      bool
	// Truncated 为 true 表示终帧是 incomplete 且原因是 max_output_tokens。
	Truncated bool
	Usage     Object
}

// wbChat 是同步调用：Responses 非流式 + 401 刷新重试一次。
func (a *App) wbChat(ctx context.Context, userID, method, path string, body any) (int, Object, error) {
	if !a.wb.Ready() {
		return 0, nil, errors.New("Workbench is not connected")
	}
	token, err := a.wbAccessToken(userID)
	if err != nil {
		return http.StatusUnauthorized, nil, err
	}
	status, data, err := a.wb.doChat(ctx, method, path, body, token)
	if err != nil {
		return status, data, err
	}
	if status == http.StatusUnauthorized {
		refreshed, refreshErr := a.wbRefresh(userID)
		if refreshErr != nil {
			return http.StatusUnauthorized, nil, refreshErr
		}
		return a.wb.doChat(ctx, method, path, body, refreshed)
	}
	return status, data, nil
}

// responsesBody 组装 Responses 请求体。参数全部来自调用方（已从后端配置取值）。
func responsesBody(model, prompt string, stream bool, maxOutput int, effort string) Object {
	body := Object{
		"model":             model,
		"input":             prompt,
		"stream":            stream,
		"max_output_tokens": maxOutput,
		// 本服务无状态，不希望在厂商侧留会话。
		"store": false,
	}
	if strings.TrimSpace(effort) != "" {
		// 后端按模型 thinking_level_map 翻译成该模型认识的表达。
		body["reasoning"] = Object{"effort": effort}
	}
	return body
}

// responsesText 从非流式响应里抽正文。
// 结构：output[] 里 type=="message" 的 content[]，取 type=="output_text" 的 text。
// 另有便捷字段 output_text（官方 SDK 用）。
func responsesText(data Object) string {
	payload := data
	if nested := sub(data, "data"); nested != nil {
		payload = nested
	}
	if text := strings.TrimSpace(str(payload, "output_text")); text != "" {
		return text
	}
	var sb strings.Builder
	for _, item := range list(payload["output"]) {
		entry, _ := item.(map[string]any)
		if entry == nil || str(entry, "type") != "message" {
			continue
		}
		for _, part := range list(entry["content"]) {
			chunk, _ := part.(map[string]any)
			if chunk == nil {
				continue
			}
			if str(chunk, "type") == "output_text" {
				sb.WriteString(str(chunk, "text"))
			}
		}
	}
	return strings.TrimSpace(sb.String())
}

// responsesTruncated 判断响应是否因上限被截断。
func responsesTruncated(data Object) bool {
	payload := data
	if nested := sub(data, "data"); nested != nil {
		payload = nested
	}
	if str(payload, "status") != "incomplete" {
		return false
	}
	details := sub(payload, "incomplete_details")
	return details == nil || str(details, "reason") == "max_output_tokens"
}

// wbChatStream 调上游 Responses 流式，逐帧回调 onDelta，返回累计正文。
func (a *App) wbChatStream(ctx context.Context, userID, model, prompt string, onDelta func(sseDelta)) (string, error) {
	if a == nil || !a.wb.Ready() {
		return "", errors.New("Workbench is not connected")
	}
	if strings.TrimSpace(prompt) == "" {
		return "", &WBError{Code: wbErrEmptyInput, Message: "文档没有可解析的正文"}
	}
	if strings.TrimSpace(model) == "" {
		model = structureRescueModel()
	}
	maxOutput := a.wbMaxOutputTokens(ctx, userID)
	effort := a.wbReasoningEffort(ctx, userID)

	var sb strings.Builder
	reasoningSeen := false
	truncated := false
	collect := func(d sseDelta) {
		if d.Reasoning != "" {
			reasoningSeen = true
		}
		if d.Truncated {
			truncated = true
		}
		if d.Content != "" {
			sb.WriteString(d.Content)
		}
		if onDelta != nil {
			onDelta(d)
		}
	}

	status, _, err := a.wbStreamRequest(ctx, userID, "/v1/responses", responsesBody(model, prompt, true, maxOutput, effort), collect)
	if err != nil {
		// 上游不接受该档位时回 400：去掉 reasoning 重试一次（不同模型兼容性不同）。
		if status == http.StatusBadRequest && effort != "" {
			sb.Reset()
			reasoningSeen, truncated = false, false
			status, _, err = a.wbStreamRequest(ctx, userID, "/v1/responses", responsesBody(model, prompt, true, maxOutput, ""), collect)
		}
		if err != nil {
			return sb.String(), err
		}
	}
	_ = status
	if truncated {
		return sb.String(), &WBError{Code: wbErrTruncated, Message: "输出被模型上限截断，请缩小资料范围或重试"}
	}
	if strings.TrimSpace(sb.String()) == "" {
		if reasoningSeen {
			return "", &WBError{Code: wbErrTruncated, Message: "模型思考过长，正文被截断，请缩小资料范围或重试"}
		}
		return "", errors.New("结构化补救未返回内容")
	}
	return sb.String(), nil
}

// wbStreamRequest 发一次流式请求，读 SSE 帧并回调。返回状态码（2xx 表示已消费完流）。
func (a *App) wbStreamRequest(ctx context.Context, userID, path string, body Object, onDelta func(sseDelta)) (int, Object, error) {
	token, err := a.wbAccessToken(userID)
	if err != nil {
		return http.StatusUnauthorized, nil, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.wb.BaseURL+path, strings.NewReader(string(raw)))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := a.wb.chatClient().Do(req)
	if err != nil {
		log.Printf("wb.stream: Client.Do failed path=%s err=%v", path, err)
		return 0, nil, wbTransportError(err)
	}
	defer resp.Body.Close()

	// 非 2xx：上游回的是 JSON 错误体，不是 SSE。
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		rawErr, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		var data Object
		_ = json.Unmarshal(rawErr, &data)
		return resp.StatusCode, data, wbStatusError(resp.StatusCode, data)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4<<20)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" || strings.HasPrefix(line, ":") {
			continue // 心跳/注释
		}
		// Responses 用 `event: <name>` + `data: <json>`，两行一组。
		if strings.HasPrefix(line, "event:") {
			continue // 事件名已包含在 data 的 type 里，无需单独处理
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" {
			continue
		}
		// 兼容旧方言（若上游仍发 [DONE]）。
		if payload == "[DONE]" {
			if onDelta != nil {
				onDelta(sseDelta{Done: true})
			}
			return resp.StatusCode, Object{}, nil
		}
		delta, terminal := parseResponsesFrame(payload)
		if onDelta != nil && (delta.Content != "" || delta.Reasoning != "" || delta.Truncated || terminal) {
			onDelta(delta)
		}
		if terminal {
			return resp.StatusCode, Object{}, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return resp.StatusCode, nil, wbTransportError(err)
	}
	return resp.StatusCode, Object{}, nil
}

// parseResponsesFrame 解析一帧 Responses SSE，返回增量与是否终帧。
//
// 终帧：response.completed / response.incomplete / response.failed
func parseResponsesFrame(payload string) (sseDelta, bool) {
	var frame Object
	if json.Unmarshal([]byte(payload), &frame) != nil {
		return sseDelta{}, false
	}
	kind := str(frame, "type")
	out := sseDelta{}
	if usage := sub(frame, "usage"); usage != nil {
		out.Usage = usage
	}
	switch kind {
	case "response.output_text.delta":
		out.Content = str(frame, "delta")
		return out, false
	case "response.reasoning_summary_text.delta", "response.reasoning_text.delta":
		out.Reasoning = str(frame, "delta")
		return out, false
	case "response.completed":
		out.Done = true
		return out, true
	case "response.incomplete":
		out.Done = true
		// 终帧里带 response.incomplete_details.reason
		if resp := sub(frame, "response"); resp != nil {
			if details := sub(resp, "incomplete_details"); details != nil && str(details, "reason") == "max_output_tokens" {
				out.Truncated = true
			}
			if details := sub(resp, "incomplete_details"); details == nil {
				out.Truncated = true
			}
		} else {
			out.Truncated = true
		}
		return out, true
	case "response.failed":
		out.Done = true
		return out, true
	}
	// 其他事件（response.created / output_item.added 等）忽略，但仍可能是最后一帧。
	return out, false
}
