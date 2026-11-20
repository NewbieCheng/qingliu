package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

// AI 分析走 ql_jobs 队列（kind=ai_analysis），不再直接起裸 goroutine：
// 进程重启可恢复、同一客户不会并发跑两份、阶段进度可以持久化给前端展示。

const aiAnalysisTimeout = 10 * time.Minute

// analyzePercent 把工作台返回的阶段映射到展示进度。这些数字只用于提示，
// 模型内部进度不可观测，所以只按已知阶段推进，不做假动画。
func analyzeStageProgress(stage string) (int, string) {
	switch stage {
	case "uploading":
		return 10, "Uploading original to analysis service"
	case "creating":
		return 25, "Creating analysis task"
	case "queued":
		return 35, "Analysis task queued"
	case "running":
		return 55, "AI is reading and organizing transactions"
	case "summarizing":
		return 90, "Summarizing analysis results"
	case "done":
		return 100, "Analysis complete"
	case "failed":
		return 0, "Analysis failed"
	default:
		return 5, "Preparing analysis"
	}
}

func (a *App) startAIAnalysis(userID, cid, docID, task string, space spaceRef) Object {
	row := a.s.one("SELECT id,name FROM ql_documents WHERE id=? AND customer_id=?", docID, cid)
	if row == nil {
		return nil
	}
	// 同一资料已有排队/运行中的分析时复用，避免重复点击产生并行任务。
	// 但超过 staleJobMinutes 的记录视为卡死，不复用，直接开新的一条。
	if existing := a.s.one("SELECT * FROM ql_ai_analyses WHERE customer_id=? AND document_id=? AND status IN ('queued','running','uploading') AND created > DATE_SUB(NOW(6), INTERVAL ? MINUTE) ORDER BY created DESC LIMIT 1", cid, docID, jobPolicy("ai_analysis").StaleMinutes); existing != nil {
		return existing
	}
	analysisID := id()
	if task == "" {
		task = "statement_review"
	}
	payload := Object{"document_id": docID, "analysis_id": analysisID, "name": str(row, "name"), "task": task}
	a.s.exec(`INSERT INTO ql_ai_analyses(id,customer_id,document_id,status,stage,progress) VALUES(?,?,?,?,?,?)`,
		analysisID, cid, docID, "queued", "queued", 5)
	a.s.exec("INSERT INTO ql_jobs(id,customer_id,user_id,kind,status,payload,message,progress,stage,space_kind,space_id) VALUES(?,?,?,'ai_analysis','queued',?,?,?,?,?,?)",
		id(), cid, userID, js(payload), "等待分析", 5, "queued", space.Kind, space.ID)
	a.s.event(space, userID, cid, "ai_analysis_queued", analysisID)
	return a.s.one("SELECT * FROM ql_ai_analyses WHERE id=?", analysisID)
}

// runAIAnalysisJob 由 worker 调用；stage 回调把工作台/本地阶段写回两张表。
//
// jid 是 ql_jobs 的主键：失败时必须同步把任务标成 failed，否则任务会停在
// queued/running 占住客户，后续上传、核对、报告全部 409。
func (a *App) runAIAnalysisJob(ctx context.Context, userID, cid, jid string, payload Object, report func(stage, message string, progress int)) {
	analysisID := str(payload, "analysis_id")
	docID := str(payload, "document_id")
	name := str(payload, "name")
	step := func(stage, message string) {
		progress, text := analyzeStageProgress(stage)
		// 调用方给的 message 常常与阶段文案相同，直接拼会得到
		// 「正在上传原件到分析服务（正在上传原件到分析服务）」这种重复。
		line := message
		if message != text {
			line = message + "（" + text + "）"
		}
		report(stage, line, progress)
		dbStatus := "running"
		switch stage {
		case "queued":
			dbStatus = "queued"
		case "failed":
			dbStatus = "failed"
		}
		a.s.exec("UPDATE ql_ai_analyses SET status=?,stage=?,progress=? WHERE id=?", dbStatus, stage, progress, analysisID)
	}
	fail := func(message string) {
		if len([]rune(message)) > 900 {
			message = string([]rune(message)[:900])
		}
		report("failed", message, 0)
		a.s.exec("UPDATE ql_ai_analyses SET status='failed',stage='failed',error=?,completed=NOW(6) WHERE id=?", message, analysisID)
		a.s.jobFinish(jid, "failed", message)
	}
	if !a.wb.Ready() {
		fail("Workbench is not connected")
		return
	}
	path := filepath.Join(a.s.root, "uploads", cid, docID)
	task := str(payload, "task")
	if task == "" {
		task = "statement_review"
	}

	// page_ocr 优先走工作台统一三通道接口 POST /v1/ocr（不关心底层是 DeepSeek/自建/VLM）；
	// 失败或空输出时再自动回退至原有 aidoc 文档上传与异步 page_ocr 管线兜底。
	if task == "page_ocr" {
		step("uploading", "Calling unified workbench OCR service (/v1/ocr)")
		if plain, readErr := a.s.read(path); readErr == nil && len(plain) > 0 {
			ocrRes, ocrErr := a.wbOCR(ctx, userID, plain, name, "text_recognition")
			if ocrErr == nil && strings.TrimSpace(ocrRes.Text) != "" {
				step("summarizing", "Summarizing analysis results")
				resultObj := Object{
					"text":         ocrRes.Text,
					"page_count":   ocrRes.PageCount,
					"channel_used": ocrRes.ChannelUsed,
					"method":       "workbench-ocr",
				}
				raw, _ := json.Marshal(resultObj)
				a.s.exec("UPDATE ql_ai_analyses SET status='done',stage='done',progress=100,result=?,completed=NOW(6) WHERE id=?", string(raw), analysisID)
				if n, wbErr := a.writebackPageOCR(cid, docID, name, resultObj); wbErr != nil {
					report("running", "OCR 识别已完成（"+ocrRes.ChannelUsed+"），但写回核对失败："+wbErr.Error(), 95)
				} else if n > 0 {
					report("summarizing", fmt.Sprintf("统一 OCR 已完成（%s），并写回 %d 笔交易到核对", ocrRes.ChannelUsed, n), 98)
				}
				return
			}
			if ocrErr != nil {
				log.Printf("qingliu page_ocr unified /v1/ocr fallback to aidoc pipeline: doc=%s err=%v", docID, ocrErr)
			}
		}
	}

	step("uploading", "Uploading original to analysis service")
	wbDocID, err := a.wbUploadDocument(ctx, userID, path, name)
	if err != nil {
		fail(err.Error())
		return
	}
	a.s.exec("UPDATE ql_ai_analyses SET workbench_document_id=? WHERE id=?", wbDocID, analysisID)
	step("creating", "Creating analysis task")
	status, data, err := a.wbRequest(ctx, userID, http.MethodPost, "/api/v1/ai/analyses", Object{
		"document_id": wbDocID, "task": task,
	})
	if err != nil || status != http.StatusAccepted {
		fail(wbFailure(data, err, "AI 分析任务创建失败"))
		return
	}
	payloadData := sub(data, "data")
	if payloadData == nil {
		fail("AI analysis response incomplete")
		return
	}
	wbAnalysisID := integer(payloadData["analysis_id"])
	if wbAnalysisID == 0 {
		fail("AI analysis response incomplete")
		return
	}
	a.s.exec("UPDATE ql_ai_analyses SET workbench_analysis_id=? WHERE id=?", wbAnalysisID, analysisID)
	step("queued", "Analysis task queued")

	poll := time.Duration(jobPolicy("ai_analysis").PollMS) * time.Millisecond
	if poll < time.Second {
		poll = 4 * time.Second
	}
	ticker := time.NewTicker(poll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			// 超时也尽量通知工作台停跑，避免清流先杀、后台仍占槽扣费。
			if wbAnalysisID > 0 {
				_, _, _ = a.wbRequest(context.Background(), userID, http.MethodPost, "/api/v1/ai/analyses/"+itoa(wbAnalysisID)+"/cancel", Object{})
			}
			fail("AI analysis timed out. Please try again later.")
			return
		case <-ticker.C:
		}
		status, data, err := a.wbRequest(ctx, userID, http.MethodGet, "/api/v1/ai/analyses/"+itoa(wbAnalysisID), nil)
		if err != nil {
			continue
		}
		if status != http.StatusOK {
			fail(wbFailure(data, nil, "AI 分析状态读取失败"))
			return
		}
		payloadData := sub(data, "data")
		if payloadData == nil {
			continue
		}
		remote := str(payloadData, "status")
		if remote == "running" {
			progress := 55
			message := "AI is reading and organizing transactions"
			if workbenchProgress := integer(payloadData["progress"]); workbenchProgress > 0 {
				// 工作台进度是展示用百分比；映射到清流 running 段，避免一开始就顶到 100。
				progress = int(40 + workbenchProgress*55/100)
				if progress > 99 {
					progress = 99
				}
				message = fmt.Sprintf("AI 正在分析（工作台进度 %d%%）", workbenchProgress)
			}
			report("running", message, progress)
			// 工作台分段完成后会带回中间 result（含 process/思考片段），同步到本地表，
			// 前端轮询就能边等边看，而不是干等终态。
			if result := payloadData["result"]; result != nil {
				raw, _ := json.Marshal(result)
				a.s.exec("UPDATE ql_ai_analyses SET status='running',stage='running',progress=?,result=? WHERE id=?", progress, string(raw), analysisID)
			} else {
				a.s.exec("UPDATE ql_ai_analyses SET status='running',stage='running',progress=? WHERE id=?", progress, analysisID)
			}
		}
		switch remote {
		case "done":
			step("summarizing", "Summarizing analysis results")
			resultObj := asObject(payloadData["result"])
			raw, _ := json.Marshal(resultObj)
			a.s.exec("UPDATE ql_ai_analyses SET status='done',stage='done',progress=100,result=?,completed=NOW(6) WHERE id=?", string(raw), analysisID)
			// S6：page_ocr 成功后把转写正文解析成交易行写回核对。
			if str(payload, "task") == "page_ocr" {
				if n, wbErr := a.writebackPageOCR(cid, docID, name, resultObj); wbErr != nil {
					report("running", "视觉识别已完成，但写回核对失败："+wbErr.Error(), 95)
				} else if n > 0 {
					report("summarizing", fmt.Sprintf("已写回 %d 笔交易到核对", n), 98)
				}
			}
			return
		case "failed":
			fail(str(payloadData, "error"))
			return
		case "cancelled":
			fail("Analysis cancelled")
			return
		}
	}
}

// writebackPageOCR 消费 page_ocr 结果里的 text，解析后写入该资料的交易行。
func (a *App) writebackPageOCR(cid, docID, name string, result Object) (int, error) {
	ocrText := str(result, "text")
	if strings.TrimSpace(ocrText) == "" {
		return 0, fmt.Errorf("分析结果没有转写正文")
	}
	doc := a.s.one("SELECT payload FROM ql_documents WHERE id=? AND customer_id=?", docID, cid)
	preferred := ""
	if doc != nil {
		preferred = str(obj(str(doc, "payload")), "source")
	}
	source, rows, err := parseOCRTranscript(ocrText, preferred)
	if err != nil {
		return 0, err
	}
	return a.s.applyOCRWriteback(cid, docID, name, source, rows)
}

func (a *App) latestAIAnalyses(cid string, limit int) []Object {
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	rows := a.s.query("SELECT id,customer_id,document_id,workbench_analysis_id,status,stage,progress,result,error,created,completed FROM ql_ai_analyses WHERE customer_id=? ORDER BY created DESC LIMIT ?", cid, limit)
	for _, row := range rows {
		if raw := str(row, "result"); raw != "" {
			row["result"] = obj(raw)
		} else {
			row["result"] = nil
		}
	}
	return rows
}

// wbFailure 保留工作台返回的具体原因码与 trace，不再把所有失败压成一句
// “文件解析失败”，否则用户和运维都无法定位是工具、页数还是模型的问题。
func wbFailure(data Object, err error, fallback string) string {
	if err != nil {
		return err.Error()
	}
	if data == nil {
		return fallback
	}
	message := wbMessage(data, fallback)
	// 工作台错误信封形如 {error:{code,message,details,trace_id}}；扁平形态也兼容。
	envelope := sub(data, "error")
	if envelope == nil {
		envelope = data
	}
	var parts []string
	if code := str(envelope, "code"); code != "" {
		parts = append(parts, code)
	}
	if trace := str(envelope, "trace_id"); trace != "" {
		parts = append(parts, "trace="+trace)
	}
	detail := sub(envelope, "details")
	if detail == nil {
		detail = sub(data, "details")
	}
	if detail != nil {
		if reason := str(detail, "reason_code"); reason != "" && !strings.Contains(message, reason) {
			parts = append(parts, reason)
		}
		if reason := str(detail, "detail"); reason != "" && !strings.Contains(message, reason) {
			parts = append(parts, reason)
		}
	}
	if len(parts) == 0 {
		return message
	}
	return message + "（" + strings.Join(parts, "；") + "）"
}

// shouldTryWorkbenchOCR 判断是否升级到工作台统一 POST /v1/ocr。
// 清流只调这一口；底层用哪个模型/通道由工作台网关编排，这里不选模型。
//
// 触发：① 图片上传直接走 /v1/ocr；② 无文字层（needs-vision）；③ 有字但版式匹配 0 行（流水类）。
// PDF 征信只收 facts，不因无交易行误触发；图片征信放行 OCR 提取原文入 facts。不再认前端勾选。
func shouldTryWorkbenchOCR(payload Object, result *ParseResult) bool {
	if result == nil {
		return false
	}
	ext := strings.ToLower(filepath.Ext(str(payload, "name")))
	isImg := isImageExt(ext)
	if ext != ".pdf" && !isImg {
		return false
	}
	source := str(result.Meta, "source")
	if source == "" {
		source = str(payload, "source")
	}
	if isImg {
		return true
	}
	method := str(result.Meta, "method")
	if method == "needs-vision" {
		return true
	}
	if source == "credit_report" {
		return false
	}
	if len(result.Rows) > 0 {
		return false
	}
	// 文字层或本机 OCR 已抽出内容，但标准行匹配失败 → 直接交给 /v1/ocr。
	if integer(result.Meta["text_pages"]) > 0 || integer(result.Meta["ocr_pages"]) > 0 {
		return true
	}
	if strings.TrimSpace(str(result.Meta, "extract_text")) != "" {
		return true
	}
	return false
}

// applyWorkbenchOCRResult 把 POST /v1/ocr 识别结果合入 ParseResult。
// 征信类只收 facts；流水类能 parseOCRTranscript 则直接入库，不能则留下 ocr_text 交后续结构化补救。
func applyWorkbenchOCRResult(result *ParseResult, ocrRes wbOCRResult) {
	if result == nil || strings.TrimSpace(ocrRes.Text) == "" {
		return
	}
	result.Meta["ocr_text"] = ocrRes.Text
	result.Meta["channel_used"] = ocrRes.ChannelUsed
	result.Meta["method"] = "workbench-ocr"
	if ocrRes.PageCount > 0 && integer(result.Meta["pages"]) == 0 {
		result.Meta["pages"] = ocrRes.PageCount
	}
	preferred := str(result.Meta, "source")
	if preferred == "credit_report" {
		facts := list(result.Meta["facts"])
		facts = append(facts, Object{
			"page": 1,
			"text": ocrRes.Text,
			"kind": "工作台统一 OCR 提取（" + ocrRes.ChannelUsed + "）",
		})
		result.Meta["facts"] = facts
		result.Meta["status"] = "success"
		result.Meta["issues"] = []string{}
		return
	}
	if src, rows, perr := parseOCRTranscript(ocrRes.Text, preferred); perr == nil && len(rows) > 0 {
		result.Rows = rows
		result.Meta["source"] = src
		result.Meta["rows"] = len(rows)
		result.Meta["status"] = "success"
		result.Meta["issues"] = []string{}
		return
	}
	if detected := detectOCRSource(ocrRes.Text, preferred); detected != "" && detected != "other" {
		result.Meta["source"] = detected
	}
	// 正文在，但套不上标准表：先记 facts，保持 partial，等结构化补救。
	facts := list(result.Meta["facts"])
	facts = append(facts, Object{
		"page": 1,
		"text": ocrRes.Text,
		"kind": "工作台统一 OCR 提取（" + ocrRes.ChannelUsed + "）",
	})
	result.Meta["facts"] = facts
	result.Meta["status"] = "partial"
	result.Meta["issues"] = appendStrings(result.Meta["issues"], "OCR 已返回正文，但未对齐标准交易行")
}

// tryEnhanceScanWithWorkbenchOCR：
//   1) 图片/扫描 PDF → POST /v1/ocr（通道由工作台选）
//   2) 能解析 → 入库
//   3) 不能（或 Word 提取正文无标准表）→ 模型结构化补救
//   4) 仍不行 → 保持 partial
func (a *App) tryEnhanceScanWithWorkbenchOCR(ctx context.Context, userID string, payload Object, fileBytes []byte, result *ParseResult, progress func(string)) {
	if a == nil || !a.wb.Ready() {
		return
	}
	if shouldTryWorkbenchOCR(payload, result) {
		if progress != nil {
			progress("正在调用工作台统一 OCR (POST /v1/ocr)...")
		}
		ocrRes, err := a.wbOCR(ctx, userID, fileBytes, str(payload, "name"), "text_recognition")
		if err != nil {
			log.Printf("qingliu upload /v1/ocr fallback to local parse: file=%s err=%v", str(payload, "name"), err)
			// OCR 调用失败时，若本地已有抽出正文，仍可尝试结构化补救。
			a.tryStructureRescueAfterOCR(ctx, userID, payload, result, progress)
			return
		}
		applyWorkbenchOCRResult(result, ocrRes)
	}
	if result != nil && len(result.Rows) > 0 {
		return
	}
	a.tryStructureRescueAfterOCR(ctx, userID, payload, result, progress)
	if result != nil && len(result.Rows) == 0 && str(result.Meta, "status") == "" {
		result.Meta["status"] = "partial"
	}
}
