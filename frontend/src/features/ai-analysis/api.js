import { api } from "@/shared/api/client.js";

export function getAnalyses(cid) {
  return api(`/api/clients/${cid}/ai-analysis`);
}

export function startAnalysis(cid) {
  return api(`/api/clients/${cid}/ai-analysis`, {});
}
