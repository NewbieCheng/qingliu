import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { readFirstSheet } from "../parse-xlsx.js";
import { rowsFromRecords } from "../map-standard.js";

function sheetBuffer(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  return XLSX.write(book, { type: "array", bookType: "xlsx" });
}

describe("parse-xlsx", () => {
  it("reads first sheet and maps bank rows", async () => {
    const buffer = sheetBuffer([
      ["交易日期", "收支方向", "金额", "交易对方", "摘要", "本方账号"],
      ["2026-01-05", "收入", "1280.50", "华丰商贸", "货款", "6222"],
      ["2026-01-12", "支出", "86.00", "超市", "消费", "6222"],
    ]);
    const records = await readFirstSheet(buffer);
    const parsed = rowsFromRecords(records, "bank_statement", "bank.xlsx");
    expect(parsed.ok).toBe(true);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].income).toBe(128050);
    expect(parsed.rows[1].expense).toBe(8600);
  });
});
