import { api } from "@/shared/api/client.js";

export function getAnalyses(cid) {
  return api(`/api/clients/${cid}/ai-analysis`);
}

// task=page_ocr 走工作台「文档视觉识别」能力链：逐页渲染 + 视觉模型转写，
// 适合扫描件、图片型流水、印章遮挡多的原件；普通文本流水仍用默认分析。
export function startAnalysis(cid, task) {
  return api(`/api/clients/${cid}/ai-analysis`, task ? { task } : {});
}
