export function isActiveStatus(status) {
  return ["uploading", "queued", "running"].includes(status);
}

export function isPersonMerge(item) {
  return item?.result?.kind === "person_merge" || item?.task === "person_merge";
}

/** 每份资料取最近一次「单源」分析（忽略同人合并记录）。items 假定按 created DESC。 */
export function latestAnalysisByDoc(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (isPersonMerge(item)) continue;
    const docId = String(item?.document_id || "").trim();
    if (!docId || map.has(docId)) continue;
    map.set(docId, item);
  }
  return map;
}

/** 可作为同人合并输入的已完成单源分析（每份资料取最新 done，不被失败重跑盖住）。 */
export function mergeCandidates(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (isPersonMerge(item) || item?.status !== "done" || !item?.id) continue;
    const docId = String(item?.document_id || "").trim();
    if (!docId || map.has(docId)) continue;
    map.set(docId, item);
  }
  return [...map.values()];
}

export function recentPersonMerges(items, limit = 5) {
  const list = (Array.isArray(items) ? items : []).filter(isPersonMerge);
  return list.slice(0, limit);
}

export function matrixStats(docs, byDoc) {
  const total = Array.isArray(docs) ? docs.length : 0;
  let done = 0;
  let failed = 0;
  let active = 0;
  for (const doc of Array.isArray(docs) ? docs : []) {
    const item = byDoc.get(String(doc.id));
    if (!item) continue;
    if (item.status === "done") done += 1;
    else if (item.status === "failed") failed += 1;
    else if (isActiveStatus(item.status)) active += 1;
  }
  return { total, done, failed, active, idle: Math.max(0, total - done - failed - active) };
}
