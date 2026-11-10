import { describe, expect, it } from "vitest";
import { enrichAIResult, formatAISummary } from "../format-result.js";

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
