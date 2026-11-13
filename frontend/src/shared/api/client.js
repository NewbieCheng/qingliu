import { randomId } from "@/shared/lib/format.js";
import { readStoredLocale, tStandalone } from "@/shared/i18n/core.js";

let csrfToken = "";
let unauthorizedHandler = null;

export class ApiError extends Error {
  constructor(message, status = 0, data = null, requestId = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.requestId = requestId;
  }
}

export function setCsrf(value) {
  csrfToken = value || "";
}

export function getCsrf() {
  return csrfToken;
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

function isFormData(value) {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

function newRequestId() {
  return randomId("r");
}

// 浏览器与后端之间断开时 fetch 只抛 TypeError("Failed to fetch")；对用户来说
// 这句话没有意义，而且掩盖了“可能已经提交成功”的事实，因此统一翻译成可操作提示。
function transportMessage(path) {
  if (typeof path === "string" && path.includes("/upload")) {
    return tStandalone("api.network_upload");
  }
  return tStandalone("api.network_default");
}

function statusMessage(status, fallback) {
  if (status === 413) return tStandalone("api.file_too_large");
  // 业务侧 503 常带具体原因（如「请重新登录工作台账号」），优先展示原文。
  if (status === 502 || status === 503 || status === 504) {
    const detail = typeof fallback === "string" ? fallback.trim() : "";
    const incomplete = tStandalone("api.request_incomplete");
    if (detail && detail !== incomplete && detail !== "Request incomplete. Please retry later.") {
      return detail;
    }
    return tStandalone("api.server_unavailable");
  }
  if (status === 524) return tStandalone("api.server_timeout");
  return fallback;
}

function parseBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function api(path, body, options = {}) {
  const { method, signal, skipAuthRedirect = false, timeout } = options;
  const hasBody = body !== undefined;
  const requestId = newRequestId();
  const controller = new AbortController();
  let timer;
  const abort = (reason) => controller.abort(reason);
  if (signal) {
    if (signal.aborted) abort(signal.reason);
    else signal.addEventListener("abort", () => abort(signal.reason), { once: true });
  }
  if (timeout && timeout > 0) {
    timer = window.setTimeout(() => abort(new Error("timeout")), timeout);
  }

  let response;
  try {
    response = await fetch(path, {
      method: method || (hasBody ? "POST" : "GET"),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
      headers: isFormData(body)
        ? { "X-CSRF-Token": csrfToken, "X-Request-ID": requestId, "X-Locale": readStoredLocale() }
        : hasBody
          ? {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrfToken,
              "X-Request-ID": requestId,
              "X-Locale": readStoredLocale(),
            }
          : { "X-CSRF-Token": csrfToken, "X-Request-ID": requestId, "X-Locale": readStoredLocale() },
      body: hasBody ? (isFormData(body) ? body : JSON.stringify(body)) : undefined,
    });
  } catch (error) {
    if (signal?.aborted && !(timeout && error?.message === "timeout")) {
      throw error;
    }
    if (error?.message === "timeout") {
      throw new ApiError(tStandalone("api.timeout"), 0, null, requestId);
    }
    throw new ApiError(transportMessage(path), 0, null, requestId);
  } finally {
    if (timer) window.clearTimeout(timer);
  }

  const text = await response.text();
  const data = parseBody(text);
  const responseRequestId = response.headers.get("X-Request-ID") || requestId;

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect && path !== "/api/login") {
      unauthorizedHandler?.();
    }
    const message = statusMessage(
      response.status,
      data.error || tStandalone("api.request_incomplete"),
    );
    // 请求号留给 UI「查看更多」，不要拼进主文案（中文界面会露出英文括号噪音）。
    throw new ApiError(message, response.status, data, response.status >= 500 ? responseRequestId : "");
  }
  return data;
}
