package main

import (
	"context"
	"encoding/json"
	"fmt"
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
	step("uploading", "Uploading original to analysis service")
	path := filepath.Join(a.s.root, "uploads", cid, docID)
	wbDocID, err := a.wbUploadDocument(ctx, userID, path, name)
	if err != nil {
		fail(err.Error())
		return
	}
	a.s.exec("UPDATE ql_ai_analyses SET workbench_document_id=? WHERE id=?", wbDocID, analysisID)
	step("creating", "Creating analysis task")
	task := str(payload, "task")
	if task == "" {
		task = "statement_review"
	}
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
