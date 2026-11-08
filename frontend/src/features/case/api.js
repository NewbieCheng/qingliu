import { api } from "@/shared/api/client.js";

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

export function originalPageURL(cid, documentId, page) {
  return `/api/clients/${cid}/original/${documentId}/${page}`;
}
