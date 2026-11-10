import { describe, expect, it } from "vitest";
import { filterSkusByAudience, orderOwnerForSku, skuAudience } from "../sku.js";

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
