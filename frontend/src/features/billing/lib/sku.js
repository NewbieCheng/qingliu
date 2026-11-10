/** SKU audience helpers — workbench metadata.audience is personal | team | (empty=any). */

export function skuAudience(sku) {
  const raw = String(sku?.metadata?.audience || "")
    .trim()
    .toLowerCase();
  if (raw === "personal" || raw === "user") return "personal";
  if (raw === "team" || raw === "enterprise" || raw === "tenant") return "team";
  return "";
}

export function filterSkusByAudience(skus, tab) {
  const list = Array.isArray(skus) ? skus : [];
  if (tab !== "personal" && tab !== "team") return list;
  return list.filter((sku) => {
    const audience = skuAudience(sku);
    return audience === "" || audience === tab;
  });
}

/** Workbench order owner: 1=personal account, 2=team pool. */
export function orderOwnerForSku(sku, space) {
  const audience = skuAudience(sku);
  const kind = space?.kind || "personal";
  const spaceId = Number(space?.id || 0);

  if (audience === "team" || (audience === "" && kind === "team")) {
    if (kind !== "team" || spaceId <= 0) {
      return {
        ok: false,
        message: "团队套餐需先切换到团队空间再下单",
      };
    }
    return { ok: true, owner_type: 2, owner_id: spaceId };
  }

  return { ok: true, owner_type: 1, owner_id: 0 };
}
