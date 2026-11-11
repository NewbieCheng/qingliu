import { api } from "@/shared/api/client.js";
import { tStandalone } from "@/shared/i18n/core.js";

export function getAnalyses(cid) {
  return api(`/api/clients/${cid}/ai-analysis`);
}

// task=page_ocr 走工作台「文档视觉识别」能力链：逐页渲染 + 视觉模型转写，
// 适合扫描件、图片型流水、印章遮挡多的原件；普通文本流水仍用默认分析。
// document_id 必选：不选文档不得开跑（总册 Q12）。
export function startAnalysis(cid, { documentId, task } = {}) {
  if (!documentId) {
    throw new Error(tStandalone("ai.pick_doc"));
  }
  const body = { document_id: documentId };
  if (task) body.task = task;
  return api(`/api/clients/${cid}/ai-analysis`, body);
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
