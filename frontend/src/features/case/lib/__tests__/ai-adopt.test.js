import { describe, expect, it } from "vitest";
import {
  adoptedAIRows,
  aiStatusLabel,
  highConfidenceSuggested,
} from "../ai-adopt.js";

describe("highConfidenceSuggested", () => {
  it("keeps only high suggested without review", () => {
    const rows = [
      { id: "1", ai_status: "suggested", ai_confidence: "high", ai_label: "excluded" },
      { id: "2", ai_status: "suggested", ai_confidence: "medium", ai_label: "pending" },
      {
        id: "3",
        ai_status: "suggested",
        ai_confidence: "high",
        ai_label: "excluded",
        review_label: "included",
      },
    ];
    expect(highConfidenceSuggested(rows).map((r) => r.id)).toEqual(["1"]);
  });
});

describe("adoptedAIRows", () => {
  it("filters adopted", () => {
    expect(
      adoptedAIRows([
        { id: "a", ai_status: "adopted" },
        { id: "b", ai_status: "suggested" },
      ]).map((r) => r.id),
    ).toEqual(["a"]);
  });
});

describe("aiStatusLabel", () => {
  it("renders suggested high", () => {
    expect(
      aiStatusLabel({
        ai_status: "suggested",
        ai_confidence: "high",
        ai_label: "excluded",
      }),
    ).toMatch(/高置信/);
  });
});
