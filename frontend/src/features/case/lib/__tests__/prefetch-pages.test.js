import { describe, expect, it } from "vitest";
import { neighborPages } from "../prefetch-pages.js";

describe("neighborPages", () => {
  it("returns both sides in the middle", () => {
    expect(neighborPages(3, 10)).toEqual([2, 4]);
  });

  it("omits invalid sides at edges", () => {
    expect(neighborPages(1, 5)).toEqual([2]);
    expect(neighborPages(5, 5)).toEqual([4]);
  });

  it("handles single-page docs", () => {
    expect(neighborPages(1, 1)).toEqual([]);
  });
});
