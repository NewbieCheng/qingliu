import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatCurrencyFen,
  formatFileSize,
  formatNumber,
} from "../format.js";

describe("format helpers", () => {
  it("formats integer cents without floating-point math", () => {
    expect(formatCents(12345)).toBe("123.45");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-123)).toBe("-1.23");
  });

  it("handles missing values", () => {
    expect(formatCents(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
  });

  it("formats yuan and file sizes", () => {
    expect(formatCurrencyFen(19900)).toBe("¥199.00");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
  });
});
