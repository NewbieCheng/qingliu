import { api, getCsrf } from "@/shared/api/client.js";
import { navigate } from "@/shared/router/index.js";

function caseURL(cid, range) {
  const query = new URLSearchParams(range || {}).toString();
  return `/api/clients/${cid}${query ? `?${query}` : ""}`;
}

export function getCase(cid, { range, view, query, page, signal }) {
  const url = new URL(caseURL(cid, range), window.location.origin);
  url.searchParams.set("view", view);
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(page));
  return api(url.pathname + url.search, undefined, { signal });
}

export function mutateCase(cid, range, action, body) {
  const query = new URLSearchParams(range || {}).toString();
  return api(
    `/api/clients/${cid}/${action}${query ? `?${query}` : ""}`,
    body,
  );
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
    navigate("/login");
    throw new Error("登录已过期请重新登录");
  }
  if (!response.ok) {
    let message = "下载失败请稍后重试";
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
      else if (data?.message) message = data.message;
    } catch {
      // 非 JSON 错误体用默认文案
    }
    const requestId = response.headers.get("X-Request-ID");
    if (requestId && response.status >= 500) message += `（请求 ${requestId.slice(0, 8)}）`;
    throw new Error(message);
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
