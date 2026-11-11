/** 本机解析统一入口：按扩展名分发；PDF 不抽交易。 */

import { extOf } from "./upload-preflight.js";
import { parseCsvText } from "./parse-csv.js";
import { rowsFromRecords } from "./map-standard.js";

export async function clientParse(file, { source } = {}) {
  const name = String(file?.name || "");
  const ext = extOf(name);

  if (ext === ".csv") {
    const text = await file.text();
    const records = parseCsvText(text);
    return rowsFromRecords(records, source, name);
  }

  if (ext === ".xlsx") {
    const { readFirstSheet } = await import("./parse-xlsx.js");
    const buffer = await file.arrayBuffer();
    const records = await readFirstSheet(buffer);
    return rowsFromRecords(records, source, name);
  }

  if (ext === ".docx") {
    const { extractDocxTables } = await import("./docx-table.js");
    const buffer = await file.arrayBuffer();
    const records = await extractDocxTables(buffer);
    return rowsFromRecords(records, source, name);
  }

  return { ok: false, reason: "need_server" };
}
