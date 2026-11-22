import { api } from "@/shared/api/client.js";
import { tStandalone } from "@/shared/i18n/core.js";

export function getAnalyses(cid) {
  return api(`/api/clients/${cid}/ai-analysis`);
}

function normalizeDocIds({ documentId, documentIds } = {}) {
  const ids = [];
  if (Array.isArray(documentIds)) {
    for (const value of documentIds) {
      const id = String(value || "").trim();
      if (id) ids.push(id);
    }
  }
  const single = String(documentId || "").trim();
  if (single) ids.push(single);
  return [...new Set(ids)];
}

// task=page_ocr 走工作台「文档视觉识别」能力链：逐页渲染 + 视觉模型转写，
// 适合扫描件、图片型流水、印章遮挡多的原件；普通文本流水仍用默认分析。
// document_id / document_ids：至少一份；多选时串行入队（服务端一次最多 10）。
export function startAnalysis(cid, { documentId, documentIds, task } = {}) {
  const ids = normalizeDocIds({ documentId, documentIds });
  if (!ids.length) {
    throw new Error(tStandalone("ai.pick_doc"));
  }
  const body = ids.length === 1
    ? { document_id: ids[0] }
    : { document_ids: ids };
  if (task) body.task = task;
  return api(`/api/clients/${cid}/ai-analysis`, body);
}

/** 同人合并：提交已完成的单源 analysis_ids（≥2），服务端只吃摘要。 */
export function startPersonMerge(cid, analysisIds = []) {
  const ids = [...new Set(
    (Array.isArray(analysisIds) ? analysisIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
  if (ids.length < 2) {
    throw new Error(tStandalone("ai.merge_need_two"));
  }
  return api(`/api/clients/${cid}/ai-analysis`, {
    task: "person_merge",
    analysis_ids: ids,
  });
}

/** 把带 transaction_id 的分析条目写入核对行 ai_* 预勾（不改正式标签）。 */
export function applyAISuggest(cid, analysisId) {
  if (!analysisId) throw new Error("Specify an analysis result");
  return api(`/api/clients/${cid}/ai-suggest`, { analysis_id: analysisId });
}

/** S6：把 page_ocr 转写正文解析写回核对交易行。 */
export function applyAIWriteback(cid, analysisId) {
  if (!analysisId) throw new Error("Specify an analysis result");
  return api(`/api/clients/${cid}/ai-writeback`, { analysis_id: analysisId });
}
