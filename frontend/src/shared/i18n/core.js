import zhCN from "./locales/zh-CN.js";
import enUS from "./locales/en-US.js";

export const LOCALES = ["zh-CN", "en-US"];
export const DEFAULT_LOCALE = "zh-CN";
const STORAGE_KEY = "ql_lang";
const CATALOGS = { "zh-CN": zhCN, "en-US": enUS };

export function normalizeLocale(value) {
  const raw = String(value || "").trim();
  if (raw === "en" || raw.toLowerCase().startsWith("en")) return "en-US";
  if (raw === "zh" || raw.toLowerCase().startsWith("zh")) return "zh-CN";
  if (LOCALES.includes(raw)) return raw;
  return DEFAULT_LOCALE;
}

export function readStoredLocale() {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_LOCALE;
    return normalizeLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

function interpolate(template, vars) {
  if (!vars || typeof template !== "string") return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

export function translate(locale, key, vars) {
  const catalog = CATALOGS[normalizeLocale(locale)] || CATALOGS[DEFAULT_LOCALE];
  const template = catalog[key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, vars);
}

export function tStandalone(key, vars) {
  return translate(readStoredLocale(), key, vars);
}
