import { describe, expect, it } from "vitest";
import { preflight } from "../upload-preflight.js";

function file(name, size = 100) {
  return { name, size };
}

describe("upload-preflight", () => {
  it("rejects empty selection", () => {
    expect(preflight([], { source: "bank_statement" }).ok).toBe(false);
  });

  it("rejects empty csv content by size", () => {
    const result = preflight([file("a.csv", 0)], {
      source: "bank_statement",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/空/);
  });

  it("rejects wrong source for tables", () => {
    const result = preflight([file("a.csv")], { source: "other" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/银行卡|微信|支付宝/);
  });

  it("rejects .doc", () => {
    const result = preflight([file("a.doc")], { source: "bank_statement" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/docx/);
  });

  it("accepts bank csv batch", () => {
    expect(
      preflight([file("bank.csv"), file("scan.pdf", 1024)], {
        source: "bank_statement",
      }).ok,
    ).toBe(true);
  });

  it("accepts pdf with other source", () => {
    expect(preflight([file("a.pdf", 2048)], { source: "other" }).ok).toBe(
      true,
    );
  });
});
