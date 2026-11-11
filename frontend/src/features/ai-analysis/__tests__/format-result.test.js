import { describe, expect, it } from "vitest";
import {
  enrichAIResult,
  formatAIExportText,
  formatAISummary,
  formatDetailLine,
  formatLocator,
  normalizeProcess,
} from "../format-result.js";

describe("formatAISummary", () => {
  it("turns raw chunk JSON into Chinese summary lines", () => {
    const raw = {
      summary:
        '[第 1 页] {"summary":"本段为微信流水","income_structure":[{"source":"小莫","amount":"420"}]}\n[第 8-9 页] {"summary":"含转账与提现"}',
      income_structure: [],
      anomalies: [],
      questions: [],
    };
    const text = formatAISummary(raw);
    expect(text).toContain("【第 1 页】本段为微信流水");
    expect(text).toContain("【第 8-9 页】含转账与提现");
    expect(text).not.toContain('"income_structure"');

    const enriched = enrichAIResult(raw);
    expect(enriched.income_structure.length).toBeGreaterThan(0);
    expect(enriched.summary).not.toContain('"summary"');
  });
});

describe("process and export", () => {
  it("normalizes process entries and builds copyable text", () => {
    expect(
      normalizeProcess([{ text: "正在阅读第 1/2 段" }, "第 1 段思考：收入稳定", ""]),
    ).toEqual(["正在阅读第 1/2 段", "第 1 段思考：收入稳定"]);

    const text = formatAIExportText({
      summary: "本月经营流入稳定",
      process: [{ text: "开始分段阅读" }, { text: "第 1 段思考：收入稳定" }],
      anomalies: [{ item: "大额提现", evidence: "第 3 页" }],
      questions: ["请核实对手方身份"],
      disclaimer: "AI 辅助，需人工复核",
    });
    expect(text).toContain("【摘要】");
    expect(text).toContain("【思考过程】");
    expect(text).toContain("第 1 段思考：收入稳定");
    expect(text).toContain("大额提现");
    expect(text).toContain("AI 辅助，需人工复核");
  });

  it("exports locator / page for anomalies", () => {
    expect(
      formatLocator({ page: 3, evidence: "右上角印章", locator: "row:12" }),
    ).toBe("第3页 · row:12 · 右上角印章");
    expect(
      formatDetailLine({
        item: "大额提现",
        amount: "20000",
        page: 3,
        evidence: "第 3 页",
      }),
    ).toContain("第3页");
    const text = formatAIExportText({
      summary: "摘要",
      anomalies: [{ item: "异常转入", page: 2, locator: "bbox:1" }],
    });
    expect(text).toContain("第2页");
    expect(text).toContain("bbox:1");
  });
});
