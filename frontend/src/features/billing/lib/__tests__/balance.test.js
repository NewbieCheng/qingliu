import { describe, expect, it } from "vitest";
import { availablePoints, periodPoints, permanentPoints } from "../balance.js";

describe("availablePoints", () => {
  it("prefers available_points from workbench", () => {
    expect(
      availablePoints({
        available_points: 101,
        points_balance: 100,
        period_points_balance: 1,
      }),
    ).toBe(101);
  });

  it("sums buckets when available_points is missing", () => {
    expect(
      availablePoints({ points_balance: 100, period_points_balance: 1 }),
    ).toBe(101);
  });

  it("returns null for empty input", () => {
    expect(availablePoints(null)).toBe(null);
  });
});

describe("bucket helpers", () => {
  it("reads permanent and period buckets", () => {
    const balance = { points_balance: 80, period_points_balance: 20 };
    expect(permanentPoints(balance)).toBe(80);
    expect(periodPoints(balance)).toBe(20);
  });
});
