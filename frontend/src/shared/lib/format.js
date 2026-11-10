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

/** 列表用相对时间：今天 HH:mm / 昨天 HH:mm / N 天前 / 日期 */
export function formatRelativeTime(value, fallback = "—", now = Date.now()) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const current = new Date(now);
  const startOfToday = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  );
  const startOfThat = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDiff = Math.round((startOfToday - startOfThat) / 86400000);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (dayDiff === 0) return `今天 ${time}`;
  if (dayDiff === 1) return `昨天 ${time}`;
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} 天前`;
  return formatDate(value, fallback);
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
