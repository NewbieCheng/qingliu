/**
 * XLSX 读簿：SheetJS community（xlsx）。
 * 理由：浏览器无原生 xlsx；服务器用 excelize，前端需等价读第一张表。
 * 只加这一个读簿库，不做编辑器。
 */

import * as XLSX from "xlsx";

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string[][]>}
 */
export async function readFirstSheet(buffer) {
  const data =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer);
  const workbook = XLSX.read(data, { type: "array", dense: true });
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) {
    throw new Error("Empty Excel");
  }
  const sheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (!Array.isArray(records)) return [];
  return records.map((row) =>
    Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [],
  );
}
