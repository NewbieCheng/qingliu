import { api, getCsrf } from "@/shared/api/client.js";
import { tStandalone } from "@/shared/i18n/core.js";
import { navigate } from "@/shared/router/index.js";
import { toast } from "@/shared/ui/toast-api.js";
import { cacheQuery, dropCache } from "@/shared/api/cache.js";
import { TTL, PERSIST, KEY, docPrefix, textPrefix, casePrefix } from "@/shared/cache/policy.js";

// 写操作之后必须主动失效：只靠 TTL 会让用户"改完看不到变化"，
// 那是比多请求一次严重得多的体验问题。
function invalidateCase(cid) {
  dropCache(casePrefix(cid));
}
function invalidateDoc(cid, did) {
  if (did) {
    dropCache(`rows:${cid}:${did}`);
    dropCache(`text:${cid}:${did}`);
  }
  dropCache(docPrefix(cid));
  dropCache(textPrefix(cid));
}

function caseURL(cid, range) {
  const query = new URLSearchParams(range || {}).toString();
  return `/api/clients/${cid}${query ? `?${query}` : ""}`;
}

// 核对页主数据：TTL 短（用户会改数据），且每次写操作后主动失效。
// force=true 用于「刷新」按钮，跳过缓存直接回源。
export function getCase(cid, { range, view, query, page, signal, force } = {}) {
  const url = new URL(caseURL(cid, range), window.location.origin);
  url.searchParams.set("view", view);
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(page));
  const path = url.pathname + url.search;
  return cacheQuery(() => api(path, undefined, { signal }), {
    key: KEY.caseView(cid, path),
    ttlMs: TTL.caseView,
    persist: PERSIST.caseView,
    force,
  });
}

export function mutateCase(cid, range, action, body) {
  const query = new URLSearchParams(range || {}).toString();
  return api(
    `/api/clients/${cid}/${action}${query ? `?${query}` : ""}`,
    body,
  ).then((res) => {
    invalidateCase(cid);
    return res;
  });
}

/** 手工新增一条交易（补录原件里漏识别的行）。服务端走同一套归一与质检。 */
export function addTransaction(cid, draft) {
  return api(`/api/clients/${cid}/transactions`, draft).then((res) => {
    invalidateCase(cid);
    return res;
  });
}

/** 删除单条交易（误识别 / 重复录入时由用户移除）。 */
export function deleteTransaction(cid, tid) {
  return api(`/api/clients/${cid}/transactions/${tid}`, undefined, {
    method: "DELETE",
  }).then((res) => {
    invalidateCase(cid);
    return res;
  });
}

/** 原件正文按页浏览：返回按页切分好的已提取文字（不渲染 PDF）。 */
// 解析产物只会在「重新解析」时变，半个月 TTL；重新解析会主动清掉，
// 所以这里的 TTL 只是兜底，不是唯一失效手段。
export function documentText(cid, did, { force } = {}) {
  return cacheQuery(
    () => api(`/api/clients/${cid}/documents/${did}/text`),
    { key: KEY.docText(cid, did), ttlMs: TTL.docText, persist: PERSIST.docText, force },
  );
}

/** 某份文档解析出的交易行（含原件原文 raw），供逐行对照。 */
export function documentRows(cid, did, { force } = {}) {
  return cacheQuery(
    () => api(`/api/clients/${cid}/documents/${did}/rows`),
    { key: KEY.docRows(cid, did), ttlMs: TTL.docRows, persist: PERSIST.docRows, force },
  );
}

/** 本机拆行入库：原件落 Vault + 服务端权威校验 rows + 扣解析分，不进 upload worker。 */
export function uploadParsed(cid, { file, rows, source, batch }) {
  const form = new FormData();
  form.set("client_parsed", "1");
  form.set("source", source);
  if (batch) form.set("batch", batch);
  form.set("rows_json", JSON.stringify(rows));
  form.append("file", file);
  return api(`/api/clients/${cid}/upload-parsed`, form).then((res) => {
    invalidateDoc(cid);
    invalidateCase(cid);
    return res;
  });
}

export function listCaseJobs(cid, { signal } = {}) {
  return api(`/api/clients/${cid}/jobs`, undefined, { signal });
}

/** 原地重解析：用已存原件按（可纠正的）来源重跑解析主干。 */
export function reparseDocument(cid, docId, source) {
  return api(`/api/clients/${cid}/documents/${docId}/reparse`, { source }).then((res) => {
    // 重新解析会重写这份文档的交易行与正文，缓存必须立刻作废。
    invalidateDoc(cid, docId);
    invalidateCase(cid);
    return res;
  });
}

/** 通用解析工具：取预设列表。 */
export function listParsePresets() {
  return api("/api/parse-presets");
}

/** 通用解析工具：对某文档按预设/自定义目标做定向提取。 */
export function generalParse(cid, docId, preset, question) {
  return api(`/api/clients/${cid}/documents/${docId}/general-parse`, {
    preset,
    question,
  }).then((res) => {
    invalidateDoc(cid, docId);
    return res;
  });
}

/** 批量重解析：把勾选的历史资料作为一批重新放回解析队列（复用 reparse）。 */
export async function reparseBatch(cid, docs) {
  const results = [];
  for (const doc of docs) {
    // 逐份入队；单份失败不阻断整批。
    try {
      const r = await reparseDocument(cid, doc.id, doc.meta?.source || "other");
      results.push({ id: doc.id, ok: true, job: r.job });
    } catch (e) {
      results.push({ id: doc.id, ok: false, error: e.message });
    }
  }
  return results;
}

export function getTransaction(cid, transactionId) {
  return api(`/api/clients/${cid}/transaction/${transactionId}`);
}

export function reportDownloadURL(cid, reportId, file) {
  return `/api/clients/${cid}/reports/${reportId}/${file}`;
}

// 报告文件下载：走 fetch 同源请求（带 cookie + CSRF），拿到 blob 后再触发
// 浏览器下载。之前是裸 <a href> 整页导航，401/404/500 都会把整页带到
// JSON 错误页，看起来像"点了没用"，还回不来；fetch 路径失败只弹 toast。
async function fetchReportFile(cid, reportId, file) {
  const response = await fetch(reportDownloadURL(cid, reportId, file), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "X-CSRF-Token": getCsrf() },
  });
  if (response.status === 401) {
    toast(tStandalone("auth.session_expired"), "error");
    navigate("/login", { replace: true });
    throw new Error(tStandalone("auth.session_expired"));
  }
  if (!response.ok) {
    let message = tStandalone("api.download_failed");
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
      else if (data?.message) message = data.message;
    } catch {
      // 非 JSON 错误体用默认文案
    }
    const requestId = response.headers.get("X-Request-ID");
    const err = new Error(message);
    if (requestId && response.status >= 500) err.requestId = requestId;
    throw err;
  }
  return response;
}

export async function downloadReport(cid, reportId, file) {
  const response = await fetchReportFile(cid, reportId, file);
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 4000);
}

// 网页快照预览：取回 HTML 文本给 iframe srcDoc 渲染，不整页跳转。
export async function previewReport(cid, reportId) {
  const response = await fetchReportFile(cid, reportId, "report.html");
  return response.text();
}

export function originalPageURL(cid, documentId, page) {
  return `/api/clients/${cid}/original/${documentId}/${page}`;
}
