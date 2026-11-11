/**
 * DOCX 本机抽表（S5）：mammoth → HTML → table 矩阵。
 * 插图过重探测见 docx-media-probe.js（分类阶段不拉 mammoth）。
 */

import mammoth from "mammoth";

/**
 * @param {ArrayBuffer|Uint8Array|Blob|File} input
 * @returns {Promise<string[][]>}
 */
export async function extractDocxTables(input) {
  const { value: html } = await mammoth.convertToHtml(await mammothInput(input));
  const tables = tablesFromHtml(html);
  if (!tables.length) {
    throw new Error("docx_no_table");
  }
  // 取单元格最多的表（流水通常是最「宽」那张）。
  tables.sort((a, b) => scoreTable(b) - scoreTable(a));
  return tables[0];
}

/**
 * @param {ArrayBuffer|Uint8Array|Blob|File} input
 * @returns {Promise<string>}
 */
export async function extractDocxText(input) {
  const { value } = await mammoth.extractRawText(await mammothInput(input));
  return String(value || "").trim();
}

/** Node/vitest 认 buffer；浏览器认 arrayBuffer。 */
async function mammothInput(input) {
  const arrayBuffer = await toArrayBuffer(input);
  if (typeof Buffer !== "undefined") {
    return { buffer: Buffer.from(arrayBuffer) };
  }
  return { arrayBuffer };
}

async function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) return input;
  if (input instanceof Uint8Array) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return input.arrayBuffer();
  }
  throw new Error("docx_invalid_input");
}

function tablesFromHtml(html) {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return [...doc.querySelectorAll("table")].map((table) =>
      [...table.querySelectorAll("tr")].map((tr) =>
        [...tr.querySelectorAll("th,td")].map((cell) =>
          String(cell.textContent || "").replace(/\s+/g, " ").trim(),
        ),
      ),
    );
  }
  return tablesFromHtmlFallback(html);
}

function tablesFromHtmlFallback(html) {
  const out = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let match;
  while ((match = tableRe.exec(html))) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(match[1]))) {
      const cells = [];
      const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1]))) {
        cells.push(
          String(cellMatch[1] || "")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\s+/g, " ")
            .trim(),
        );
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

function scoreTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const cols = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)));
  return rows.length * 10 + cols;
}
