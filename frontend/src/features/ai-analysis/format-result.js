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
  next.process = normalizeProcess(result.process);
  return next;
}

/** 过程/思考条目：工作台写入的 process 数组，兼容纯字符串。 */
export function normalizeProcess(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return String(item.text || item.message || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

/** 复制/导出用的纯文本：摘要 + 过程 + 明细。 */
export function formatAIExportText(result) {
  const enriched = enrichAIResult(result);
  if (!enriched || typeof enriched !== "object") return "";
  const blocks = [];
  const summary = formatAISummary(enriched) || enriched.summary || "";
  if (summary) blocks.push("【摘要】\n" + summary);
  if (enriched.process?.length) {
    blocks.push("【思考过程】\n" + enriched.process.map((line) => `· ${line}`).join("\n"));
  }
  const sections = [
    ["Income mix", enriched.income_structure],
    ["异常点", enriched.anomalies],
    ["Suggested review", enriched.questions],
  ];
  for (const [label, rows] of sections) {
    if (!rows?.length) continue;
    const lines = rows.map((row) => formatDetailLine(row));
    blocks.push(`【${label}】\n` + lines.join("\n"));
  }
  if (enriched.disclaimer) blocks.push(String(enriched.disclaimer));
  return blocks.join("\n\n").trim();
}

export async function copyText(text) {
  const value = String(text || "");
  if (!value) throw new Error("没有可复制的内容");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export function downloadText(filename, text) {
  const value = String(text || "");
  if (!value) throw new Error("没有可导出的内容");
  const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "ai-analysis.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 明细行展示/导出：优先带定位（页码 / locator / evidence）。 */
export function formatDetailLine(row) {
  if (typeof row === "string") return `· ${row}`;
  if (!row || typeof row !== "object") return "·";
  const head = row.item || row.source || row.label || "";
  const amount = row.amount ? ` · ${row.amount}` : "";
  const locator = formatLocator(row);
  return `· ${head}${amount}${locator ? `（${locator}）` : ""}`.trim();
}

export function formatLocator(row) {
  if (!row || typeof row !== "object") return "";
  const parts = [];
  if (row.page != null && String(row.page).trim() !== "") {
    parts.push(`第${row.page}页`);
  }
  if (row.locator) parts.push(String(row.locator));
  if (row.evidence) parts.push(String(row.evidence));
  if (row.ai_locator) parts.push(String(row.ai_locator));
  // 去重保序
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join(" · ");
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
