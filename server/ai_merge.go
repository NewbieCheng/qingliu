package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

const personMergeTask = "person_merge"

// startPersonMerge 用已完成的多份单源分析摘要做同人合并解读。
// 锚定 document_id 取第一份源分析的原件（满足外键）；结果 result.kind=person_merge。
func (a *App) startPersonMerge(userID, cid string, analysisIDs []string, space spaceRef) Object {
	ids := uniqueNonEmpty(analysisIDs)
	if len(ids) < 2 {
		bad(400, "同人合并至少需要 2 份已完成的单源分析")
	}
	if len(ids) > 5 {
		bad(400, "同人合并一次最多 5 份分析")
	}
	sources := make([]Object, 0, len(ids))
	for _, analysisID := range ids {
		row := a.s.one("SELECT id,document_id,status,result FROM ql_ai_analyses WHERE id=? AND customer_id=?", analysisID, cid)
		if row == nil {
			bad(400, "分析记录不存在："+analysisID)
		}
		if str(row, "status") != "done" {
			bad(400, "只能合并已完成的分析")
		}
		result := obj(str(row, "result"))
		if str(result, "kind") == personMergeTask {
			bad(400, "不能把合并解读再当作合并输入")
		}
		sources = append(sources, row)
	}
	anchorDoc := str(sources[0], "document_id")
	doc := a.s.one("SELECT id,name FROM ql_documents WHERE id=? AND customer_id=?", anchorDoc, cid)
	if doc == nil {
		bad(400, "锚定资料不存在")
	}
	analysisID := id()
	payload := Object{
		"document_id":         anchorDoc,
		"analysis_id":         analysisID,
		"name":                "同人合并解读",
		"task":                personMergeTask,
		"source_analysis_ids": ids,
	}
	a.s.exec(`INSERT INTO ql_ai_analyses(id,customer_id,document_id,status,stage,progress) VALUES(?,?,?,?,?,?)`,
		analysisID, cid, anchorDoc, "queued", "queued", 5)
	a.s.exec("INSERT INTO ql_jobs(id,customer_id,user_id,kind,status,payload,message,progress,stage,space_kind,space_id) VALUES(?,?,?,'ai_analysis','queued',?,?,?,?,?,?)",
		id(), cid, userID, js(payload), "等待同人合并解读", 5, "queued", space.Kind, space.ID)
	a.s.event(space, userID, cid, "ai_person_merge_queued", analysisID)
	return a.s.one("SELECT * FROM ql_ai_analyses WHERE id=?", analysisID)
}

func (a *App) runPersonMergeJob(ctx context.Context, userID, cid, jid string, payload Object, report func(stage, message string, progress int)) {
	analysisID := str(payload, "analysis_id")
	fail := func(message string) {
		if utf8.RuneCountInString(message) > 900 {
			message = string([]rune(message)[:900])
		}
		report("failed", message, 0)
		a.s.exec("UPDATE ql_ai_analyses SET status='failed',stage='failed',error=?,completed=NOW(6) WHERE id=?", message, analysisID)
		a.s.jobFinish(jid, "failed", message)
	}
	step := func(stage string, progress int, message string) {
		report(stage, message, progress)
		dbStatus := "running"
		if stage == "queued" {
			dbStatus = "queued"
		}
		a.s.exec("UPDATE ql_ai_analyses SET status=?,stage=?,progress=? WHERE id=?", dbStatus, stage, progress, analysisID)
	}

	ids := uniqueNonEmpty(strList(payload["source_analysis_ids"]))
	if len(ids) == 0 {
		for _, item := range list(payload["source_analysis_ids"]) {
			if code := strings.TrimSpace(text(item)); code != "" {
				ids = append(ids, code)
			}
		}
		ids = uniqueNonEmpty(ids)
	}
	if len(ids) < 2 {
		fail("合并输入不足")
		return
	}

	step("creating", 20, "整理各来源分析摘要")
	blocks := make([]string, 0, len(ids))
	sourceMeta := make([]Object, 0, len(ids))
	for i, idv := range ids {
		row := a.s.one("SELECT id,document_id,result FROM ql_ai_analyses WHERE id=? AND customer_id=? AND status='done'", idv, cid)
		if row == nil {
			fail("合并源分析不可用：" + idv)
			return
		}
		doc := a.s.one("SELECT name,payload FROM ql_documents WHERE id=? AND customer_id=?", str(row, "document_id"), cid)
		name := str(doc, "name")
		source := ""
		if doc != nil {
			source = str(obj(str(doc, "payload")), "source")
		}
		summary := truncateRunes(analysisSummaryForMerge(obj(str(row, "result"))), 2800)
		if strings.TrimSpace(summary) == "" {
			summary = "（该来源分析无可用摘要）"
		}
		label := fmt.Sprintf("来源%d", i+1)
		if source != "" {
			label += " · " + source
		}
		if name != "" {
			label += " · " + name
		}
		blocks = append(blocks, "【"+label+"】\n"+summary)
		sourceMeta = append(sourceMeta, Object{
			"analysis_id": idv,
			"document_id": str(row, "document_id"),
			"name":        name,
			"source":      source,
		})
	}

	step("running", 55, "正在生成同人合并解读")
	prompt := personMergePrompt(blocks)
	out, err := a.wbChatText(ctx, userID, structureRescueModel(), prompt)
	if err != nil {
		fail(err.Error())
		return
	}
	summary := strings.TrimSpace(out)
	if summary == "" {
		fail("合并解读结果为空")
		return
	}
	step("summarizing", 90, "汇总合并结果")
	resultObj := Object{
		"kind":                personMergeTask,
		"summary":             truncateRunes(summary, 12000),
		"source_analysis_ids": ids,
		"sources":             sourceMeta,
		"disclaimer":          "同人合并解读基于各来源 AI 摘要，需人工复核；不替代覆盖确认与正式报告。",
	}
	raw, _ := json.Marshal(resultObj)
	a.s.exec("UPDATE ql_ai_analyses SET status='done',stage='done',progress=100,result=?,completed=NOW(6) WHERE id=?", string(raw), analysisID)
	report("done", "同人合并解读已完成", 100)
}

func analysisSummaryForMerge(result Object) string {
	if result == nil {
		return ""
	}
	if s := strings.TrimSpace(str(result, "summary")); s != "" {
		return s
	}
	parts := []string{}
	if n := len(asSlice(result["anomalies"])); n > 0 {
		parts = append(parts, fmt.Sprintf("异常点 %d 条", n))
	}
	if n := len(asSlice(result["questions"])); n > 0 {
		parts = append(parts, fmt.Sprintf("待核实 %d 条", n))
	}
	if n := len(asSlice(result["income_structure"])); n > 0 {
		parts = append(parts, fmt.Sprintf("收入结构 %d 条", n))
	}
	return strings.Join(parts, "；")
}

func personMergePrompt(blocks []string) string {
	var b strings.Builder
	b.WriteString("你是信贷尽调助手。下面是同一客户多份流水资料的 AI 分析摘要（银行卡/微信等可能分属不同渠道）。\n")
	b.WriteString("请做「同人合并解读」，不要复述原文表格。输出中文，结构如下：\n")
	b.WriteString("1) 同人一致性：姓名/账户口径是否互相印证\n")
	b.WriteString("2) 跨渠道资金闭环：明显的微信↔银行卡对应关系（只写有依据的）\n")
	b.WriteString("3) 重复与冲突：疑似重复计入、口径冲突\n")
	b.WriteString("4) 尽调关注点：需人工核实的 3–7 条\n")
	b.WriteString("5) 结论：一两句给经办人\n")
	b.WriteString("禁止编造金额与对手方；摘要不足时明确写「依据不足」。\n\n")
	b.WriteString(strings.Join(blocks, "\n\n"))
	return b.String()
}

func uniqueNonEmpty(ids []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, idv := range ids {
		idv = strings.TrimSpace(idv)
		if idv == "" || seen[idv] {
			continue
		}
		seen[idv] = true
		out = append(out, idv)
	}
	return out
}

func asSlice(v any) []any {
	if list, ok := v.([]any); ok {
		return list
	}
	return nil
}
