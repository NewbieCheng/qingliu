import { describe, expect, it } from "vitest";
import {
  filterSkusByAudience,
  ineligibleLabel,
  isSkuPurchasable,
  orderOwnerForSku,
  skuAudience,
  skuKind,
} from "../sku.js";

describe("skuAudience", () => {
  it("normalizes metadata.audience", () => {
    expect(skuAudience({ metadata: { audience: "personal" } })).toBe("personal");
    expect(skuAudience({ metadata: { audience: "enterprise" } })).toBe("team");
    expect(skuAudience({ metadata: {} })).toBe("");
  });
});

describe("filterSkusByAudience", () => {
  const skus = [
    { code: "p", metadata: { audience: "personal" } },
    { code: "t", metadata: { audience: "team" } },
    { code: "any", metadata: {} },
  ];

  it("keeps personal + unrestricted on personal tab", () => {
    expect(filterSkusByAudience(skus, "personal").map((s) => s.code)).toEqual([
      "p",
      "any",
    ]);
  });

  it("keeps team + unrestricted on team tab", () => {
    expect(filterSkusByAudience(skus, "team").map((s) => s.code)).toEqual([
      "t",
      "any",
    ]);
  });
});

describe("skuKind / purchasable", () => {
  it("derives plan vs topup", () => {
    expect(skuKind({ sku_kind: "plan" })).toBe("plan");
    expect(skuKind({ subscription: true })).toBe("plan");
    expect(skuKind({ points_kind: "permanent" })).toBe("topup");
  });

  it("keeps unavailable cards visible but not purchasable", () => {
    expect(isSkuPurchasable({ purchasable: false })).toBe(false);
    expect(isSkuPurchasable({})).toBe(true);
    expect(ineligibleLabel({ ineligible_reason: "purchase_window_limit" })).toMatch(
      /本月/,
    );
    expect(
      ineligibleLabel({
        ineligible_reason: "purchase_window_limit",
        purchase_window: "calendar_year",
      }),
    ).toMatch(/本年/);
    expect(
      ineligibleLabel({
        ineligible_reason: "purchase_window_limit",
        purchase_window: "calendar_quarter",
      }),
    ).toMatch(/本季/);
    expect(
      ineligibleLabel({
        ineligible_reason: "purchase_window_limit",
        purchase_window: "rolling_days",
        purchase_window_days: 90,
      }),
    ).toMatch(/90/);
    expect(
      ineligibleLabel({
        ineligible_reason: "purchase_window_limit",
        purchase_window: "none",
      }),
    ).toMatch(/上限/);
    expect(
      ineligibleLabel({ ineligible_reason: "not_within_registration_window" }),
    ).toMatch(/注册期/);
    expect(ineligibleLabel({ ineligible_reason: "owner_not_authorized" })).toMatch(
      /无权为企业购买/,
    );
  });
});

describe("orderOwnerForSku", () => {
  it("routes team sku to current team space", () => {
    expect(
      orderOwnerForSku(
        { metadata: { audience: "team" } },
        { kind: "team", id: 9 },
      ),
    ).toEqual({ ok: true, owner_type: 2, owner_id: 9 });
  });

  it("blocks team sku while in personal space", () => {
    const result = orderOwnerForSku(
      { metadata: { audience: "team" } },
      { kind: "personal", id: 0 },
    );
    expect(result.ok).toBe(false);
  });

  it("routes personal sku to personal owner", () => {
    expect(
      orderOwnerForSku(
        { metadata: { audience: "personal" } },
        { kind: "team", id: 9 },
      ),
    ).toEqual({ ok: true, owner_type: 1, owner_id: 0 });
  });
});
