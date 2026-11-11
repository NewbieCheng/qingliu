import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsvText } from "../parse-csv.js";
import { rowsFromRecords } from "../map-standard.js";

const samples = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../samples",
);

describe("parseCsvText + map-standard", () => {
  it("parses bank_statement fixture", () => {
    const text = readFileSync(join(samples, "bank_statement.csv"), "utf8");
    const records = parseCsvText(text);
    const parsed = rowsFromRecords(records, "bank_statement", "bank_statement.csv");
    expect(parsed.ok).toBe(true);
    expect(parsed.rows).toHaveLength(6);
    expect(parsed.rows[0].direction).toBe("income");
    expect(parsed.rows[0].income).toBe(128050);
    expect(parsed.rows[2].direction).toBe("expense");
    expect(parsed.rows[2].expense).toBe(8600);
  });

  it("parses split income/expense columns", () => {
    const text = readFileSync(join(samples, "bank_split_amount.csv"), "utf8");
    const parsed = rowsFromRecords(
      parseCsvText(text),
      "bank_statement",
      "bank_split_amount.csv",
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0].income).toBe(98000);
    expect(parsed.rows[1].expense).toBe(12000);
  });

  it("parses wechat fixture with 金额(元)", () => {
    const text = readFileSync(join(samples, "wechat_statement.csv"), "utf8");
    const parsed = rowsFromRecords(
      parseCsvText(text),
      "wechat_statement",
      "wechat_statement.csv",
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0].income).toBe(8800);
    expect(parsed.rows[1].expense).toBe(2550);
  });

  it("rejects empty table", () => {
    const text = readFileSync(join(samples, "bad_empty.csv"), "utf8");
    const parsed = rowsFromRecords(
      parseCsvText(text),
      "bank_statement",
      "bad_empty.csv",
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("empty");
  });

  it("handles quoted commas", () => {
    const records = parseCsvText('a,b\n"1,2",3\n');
    expect(records).toEqual([
      ["a", "b"],
      ["1,2", "3"],
    ]);
  });
});
