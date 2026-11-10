import { randomId } from "@/shared/lib/format.js";

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
const NETWORK_MESSAGES = {
  upload: "网络连接中断，文件可能尚未提交完整，请重试",
  default: "网络连接中断，请检查网络后重试",
};

function transportMessage(path) {
  if (typeof path !== "string") return NETWORK_MESSAGES.default;
  return path.includes("/upload") ? NETWORK_MESSAGES.upload : NETWORK_MESSAGES.default;
}

function statusMessage(status, fallback) {
  if (status === 413) return "文件过大，已超过服务器允许的上传大小";
  // 业务侧 503 常带具体原因（如「请重新登录工作台账号」），优先展示原文。
  if (status === 502 || status === 503 || status === 504) {
    const detail = typeof fallback === "string" ? fallback.trim() : "";
    if (detail && detail !== "请求未完成，请稍后重试") return detail;
    return "服务器暂时不可用，请稍后重试";
  }
  if (status === 524) return "服务器处理超时，请稍后重试";
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
        ? { "X-CSRF-Token": csrfToken, "X-Request-ID": requestId }
        : hasBody
          ? { "Content-Type": "application/json", "X-CSRF-Token": csrfToken, "X-Request-ID": requestId }
          : { "X-CSRF-Token": csrfToken, "X-Request-ID": requestId },
      body: hasBody ? (isFormData(body) ? body : JSON.stringify(body)) : undefined,
    });
  } catch (error) {
    if (signal?.aborted && !(timeout && error?.message === "timeout")) {
      throw error;
    }
    if (error?.message === "timeout") {
      throw new ApiError("请求超时，请稍后重试", 0, null, requestId);
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
      data.error || "请求未完成，请稍后重试",
    );
    const suffix = responseRequestId && response.status >= 500 ? `（请求 ${responseRequestId.slice(0, 8)}）` : "";
    throw new ApiError(`${message}${suffix}`, response.status, data, responseRequestId);
  }
  return data;
}
