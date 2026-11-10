/**
 * 把工作台返回的 AI result 整理成可读摘要。
 * 旧数据可能把整段模型 JSON 原文塞进 summary，这里尽量再解析一次。
 */
export function formatAISummary(result) {
  if (!result || typeof result !== "object") return "";
  const raw = typeof result.summary === "string" ? result.summary.trim() : "";
  if (!raw) return "";

  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const readable = [];
  for (const line of lines) {
    const scoped = line.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    const scope = scoped ? scoped[1] : "";
    const body = scoped ? scoped[2].trim() : line;
    const parsed = tryParseJSONObject(body);
    if (parsed && typeof parsed.summary === "string" && parsed.summary.trim()) {
      readable.push(scope ? `【${scope}】${parsed.summary.trim()}` : parsed.summary.trim());
      continue;
    }
    if (looksLikeJSON(body)) {
      readable.push(scope ? `【${scope}】本段已生成，请打开完整结果查看明细` : "本段已生成，请打开完整结果查看明细");
      continue;
    }
    readable.push(line);
  }
  return readable.join("\n");
}

export function enrichAIResult(result) {
  if (!result || typeof result !== "object") return result;
  const next = { ...result };
  const raw = typeof result.summary === "string" ? result.summary : "";
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const income = Array.isArray(result.income_structure) ? [...result.income_structure] : [];
  const anomalies = Array.isArray(result.anomalies) ? [...result.anomalies] : [];
  const questions = Array.isArray(result.questions) ? [...result.questions] : [];

  for (const line of lines) {
    const scoped = line.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
    const scope = scoped ? scoped[1] : "";
    const body = scoped ? scoped[2].trim() : line;
    const parsed = tryParseJSONObject(body);
    if (!parsed) continue;
    appendScoped(income, parsed.income_structure, scope);
    appendScoped(anomalies, parsed.anomalies, scope);
    appendScoped(questions, parsed.questions, scope);
  }

  next.summary = formatAISummary(result);
  next.income_structure = income;
  next.anomalies = anomalies;
  next.questions = questions;
  return next;
}

function appendScoped(target, value, scope) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (item == null) continue;
    if (typeof item === "string") {
      target.push(scope ? `${item}（${scope}）` : item);
      continue;
    }
    if (typeof item === "object") {
      target.push(scope && !item.page ? { ...item, page: scope } : item);
    }
  }
}

function looksLikeJSON(text) {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[") || t.includes('"summary"');
}

function tryParseJSONObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim();
  const candidate = extractJSONObject(cleaned) || cleaned;
  try {
    const value = JSON.parse(candidate);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function extractJSONObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}
