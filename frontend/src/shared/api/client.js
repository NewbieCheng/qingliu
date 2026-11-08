let csrfToken = "";
let unauthorizedHandler = null;

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
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

export async function api(path, body, options = {}) {
  const { method, signal, skipAuthRedirect = false } = options;
  const hasBody = body !== undefined;
  const response = await fetch(path, {
    method: method || (hasBody ? "POST" : "GET"),
    cache: "no-store",
    credentials: "same-origin",
    signal,
    headers: isFormData(body)
      ? { "X-CSRF-Token": csrfToken }
      : hasBody
        ? { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }
        : { "X-CSRF-Token": csrfToken },
    body: hasBody ? (isFormData(body) ? body : JSON.stringify(body)) : undefined,
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect && path !== "/api/login") {
      unauthorizedHandler?.();
    }
    throw new ApiError(
      data.error || "请求未完成，请稍后重试",
      response.status,
      data,
    );
  }
  return data;
}
