import { describe, expect, it } from "vitest";
import { isExpired, isResumable, orderStatusLabel, remainingMs } from "../order.js";

describe("billing order helpers", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  it("detects expired pending orders", () => {
    expect(isExpired({ status: "pending", expires_at: past })).toBe(true);
    expect(isExpired({ status: "pending", expires_at: future })).toBe(false);
    expect(isExpired({ status: "paid", expires_at: past })).toBe(false);
  });

  it("only resumes payable orders with a real QR code", () => {
    const base = { status: "pending", expires_at: future, code_url: "https://pay" };
    expect(isResumable(base)).toBe(true);
    expect(isResumable({ ...base, code_url: "mock://test" })).toBe(false);
  });

  it("labels closed expired orders as expired", () => {
    expect(orderStatusLabel({ status: "closed", expires_at: past })).toBe("已过期");
    expect(orderStatusLabel({ status: "paid" })).toBe("已支付");
  });

  it("never returns negative remaining time", () => {
    expect(remainingMs({ expires_at: past })).toBe(0);
  });
});
