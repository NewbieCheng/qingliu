/** SKU audience helpers — workbench metadata.audience is personal | team | (empty=any). */

export function skuAudience(sku) {
  const raw = String(sku?.metadata?.audience || "")
    .trim()
    .toLowerCase();
  if (raw === "personal" || raw === "user") return "personal";
  if (raw === "team" || raw === "enterprise" || raw === "tenant") return "team";
  return "";
}

/** plan=周期套餐，topup=额度充值包；缺省按 subscription / points_kind 回推。 */
export function skuKind(sku) {
  const raw = String(sku?.sku_kind || "")
    .trim()
    .toLowerCase();
  if (raw === "plan" || raw === "topup") return raw;
  if (sku?.subscription || sku?.points_kind === "period") return "plan";
  return "topup";
}

/** purchasable 缺省视为可买（兼容旧接口未返回该字段）。 */
export function isSkuPurchasable(sku) {
  if (sku?.purchasable === false) return false;
  return true;
}

export function ineligibleLabel(sku) {
  switch (String(sku?.ineligible_reason || "")) {
    case "purchase_window_limit":
      return "本月已购买，下月可再买";
    case "not_new_user":
      return "仅新用户可购";
    case "audience_mismatch":
      return "与当前账户类型不匹配";
    case "inactive":
      return "已下架";
    default:
      return "";
  }
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
