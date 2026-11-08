export function formatCents(value) {
  if (value == null || value === "") return "—";
  const text = String(value);
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  const whole = digits.length > 2 ? digits.slice(0, -2) : "0";
  const fraction = digits.slice(-2).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function formatCurrencyFen(value) {
  return `¥${(Number(value || 0) / 100).toFixed(2)}`;
}

export function formatNumber(value, fallback = "—") {
  if (value == null || value === "") return fallback;
  return Number(value).toLocaleString("zh-CN");
}

export function formatDateTime(value, fallback = "—") {
  if (!value) return fallback;
  return new Date(value).toLocaleString("zh-CN");
}

export function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  return new Date(value).toLocaleDateString("zh-CN");
}

export function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// 浏览器安全的随机 ID：优先用 Web Crypto，旧环境退化为时间戳+随机数。
export function randomId(prefix = "id") {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  const random =
    webCrypto && typeof webCrypto.randomUUID === "function"
      ? webCrypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}
