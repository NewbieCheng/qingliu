package main

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"time"
)

// startAIAnalysis uploads the original document to the workbench's document
// service, queues an analysis there, and mirrors status/result into the local
// customer record. The HTTP handler returns immediately; the browser polls the
// local endpoint.
func (a *App) startAIAnalysis(userID, cid, docID string) Object {
	row := a.s.one("SELECT id,name FROM ql_documents WHERE id=? AND customer_id=?", docID, cid)
	if row == nil {
		return nil
	}
	name := str(row, "name")
	analysisID := id()
	a.s.exec(`INSERT INTO ql_ai_analyses(id,customer_id,document_id,status) VALUES(?,?,?,?)`,
		analysisID, cid, docID, "uploading")
	go a.runAIAnalysis(userID, cid, docID, analysisID, name)
	return a.s.one("SELECT * FROM ql_ai_analyses WHERE id=?", analysisID)
}

func (a *App) runAIAnalysis(userID, cid, docID, analysisID, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	fail := func(message string) {
		a.s.exec("UPDATE ql_ai_analyses SET status='failed',error=?,completed=NOW(6) WHERE id=?", message, analysisID)
	}
	if !a.wb.Ready() {
		fail("尚未接入工作台")
		return
	}
	path := filepath.Join(a.s.root, "uploads", cid, docID)
	wbDocID, err := a.wbUploadDocument(ctx, userID, path, name)
	if err != nil {
		fail(err.Error())
		return
	}
	a.s.exec("UPDATE ql_ai_analyses SET workbench_document_id=?,status='queued' WHERE id=?", wbDocID, analysisID)

	status, data, err := a.wbRequest(ctx, userID, http.MethodPost, "/api/v1/ai/analyses", Object{
		"document_id": wbDocID, "task": "statement_review",
	})
	if err != nil || status != http.StatusAccepted {
		fail(wbMessage(data, "AI 分析任务创建失败"))
		return
	}
	payload := sub(data, "data")
	if payload == nil {
		fail("AI 分析任务返回不完整")
		return
	}
	wbAnalysisID := integer(payload["analysis_id"])
	if wbAnalysisID == 0 {
		fail("AI 分析任务返回不完整")
		return
	}
	a.s.exec("UPDATE ql_ai_analyses SET workbench_analysis_id=?,status='running' WHERE id=?", wbAnalysisID, analysisID)

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			fail("AI 分析超时，请稍后重试")
			return
		case <-ticker.C:
		}
		status, data, err := a.wbRequest(ctx, userID, http.MethodGet, "/api/v1/ai/analyses/"+itoa(wbAnalysisID), nil)
		if err != nil {
			continue
		}
		if status != http.StatusOK {
			fail(wbMessage(data, "AI 分析状态读取失败"))
			return
		}
		payload := sub(data, "data")
		if payload == nil {
			continue
		}
		switch str(payload, "status") {
		case "done":
			raw, _ := json.Marshal(payload["result"])
			a.s.exec("UPDATE ql_ai_analyses SET status='done',result=?,completed=NOW(6) WHERE id=?", string(raw), analysisID)
			return
		case "failed":
			fail(str(payload, "error"))
			return
		}
	}
}

func (a *App) latestAIAnalyses(cid string, limit int) []Object {
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	rows := a.s.query("SELECT id,customer_id,document_id,workbench_analysis_id,status,result,error,created,completed FROM ql_ai_analyses WHERE customer_id=? ORDER BY created DESC LIMIT ?", cid, limit)
	for _, row := range rows {
		if raw := str(row, "result"); raw != "" {
			row["result"] = obj(raw)
		} else {
			row["result"] = nil
		}
	}
	return rows
}
