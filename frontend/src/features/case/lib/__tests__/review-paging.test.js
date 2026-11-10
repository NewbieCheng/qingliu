import { describe, expect, it } from "vitest";
import {
  reviewCanNext,
  reviewPagerLabel,
  reviewTotalPages,
} from "../review-paging.js";

describe("review-paging", () => {
  it("computes 4 pages for 163 rows at 50/page", () => {
    expect(reviewTotalPages(163)).toBe(4);
    expect(reviewCanNext(3, 163)).toBe(true);
    expect(reviewCanNext(4, 163)).toBe(false);
    expect(reviewPagerLabel(4, 163)).toBe("第 4 / 4 页 · 共 163 笔");
  });
});
