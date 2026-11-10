import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatCurrencyFen,
  formatFileSize,
  formatNumber,
  formatRelativeTime,
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

  it("formats relative list times", () => {
    const now = new Date("2026-11-10T20:30:00");
    expect(
      formatRelativeTime("2026-11-10T08:05:00", "—", now.getTime()),
    ).toBe("今天 08:05");
    expect(
      formatRelativeTime("2026-11-09T19:24:00", "—", now.getTime()),
    ).toBe("昨天 19:24");
    expect(
      formatRelativeTime("2026-11-07T10:00:00", "—", now.getTime()),
    ).toBe("3 天前");
    expect(formatRelativeTime(null)).toBe("—");
  });
});
