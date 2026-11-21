package main

// sse.go —— qingliu 对浏览器下发的 SSE（子协议见 docs/计划-AI面板重做+流式+不支持资料分流.md）。
//
// 事件类型：
//   stage  {"type":"stage","name":"..."}      阶段提示（立即显示，缓解等待焦虑）
//   delta  {"type":"delta","text":"..."}      正文增量
//   done   {"type":"done","result":{...}}     成功终态，带结构化结果
//   error  {"type":"error","code":"...","message":"..."}  失败终态
//
// 关键：必须 Flush，否则 Nginx/代理会缓冲成一次性响应。

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

type sseStream struct {
	w       http.ResponseWriter
	flusher http.Flusher
	broken  bool // 客户端断开后不再写
}

func newSSE(w http.ResponseWriter) *sseStream {
	s := &sseStream{w: w}
	if f, ok := w.(http.Flusher); ok {
		s.flusher = f
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	// 关掉 Nginx 缓冲，否则逐字输出会攒成一次响应。
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	s.flush()
	return s
}

func (s *sseStream) flush() {
	if s == nil || s.flusher == nil {
		return
	}
	s.flusher.Flush()
}

func (s *sseStream) write(payload any) {
	if s == nil || s.broken {
		return
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	if _, err := fmt.Fprintf(s.w, "data: %s\n\n", raw); err != nil {
		s.broken = true
		return
	}
	s.flush()
}

// Stage 发一条阶段提示。
func (s *sseStream) Stage(name string) {
	s.write(Object{"type": "stage", "name": name})
}

// Delta 发一条正文增量。
func (s *sseStream) Delta(text string) {
	if text == "" {
		return
	}
	s.write(Object{"type": "delta", "text": text})
}

// Done 发成功终态。
func (s *sseStream) Done(result Object) {
	s.write(Object{"type": "done", "result": result})
}

// Fail 发失败终态：带 code 让前端给人话建议。
func (s *sseStream) Fail(err error) {
	code, message := wbErrDetail(err)
	s.write(Object{"type": "error", "code": code, "message": message})
}

// wbErrDetail 拆出 (code, message)；非 WBError 归到 unknown 并保留原文。
func wbErrDetail(err error) (string, string) {
	if err == nil {
		return wbErrUnknown, "未知错误"
	}
	var wbErr *WBError
	if errors.As(err, &wbErr) && wbErr != nil {
		return wbErr.Code, wbErr.Message
	}
	return wbErrUnknown, err.Error()
}
