import { tStandalone } from "@/shared/i18n/core.js";

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
    case "purchase_window_limit": {
      const window = String(sku?.purchase_window || "")
        .trim()
        .toLowerCase();
      if (window === "calendar_year") return tStandalone("billing.sku_limit_year");
      if (window === "calendar_quarter") return tStandalone("billing.sku_limit_quarter");
      if (window === "rolling_days") {
        const days = Number(sku?.purchase_window_days || 0);
        return days > 0
          ? tStandalone("billing.sku_limit_rolling_days", { days })
          : tStandalone("billing.sku_limit_retry");
      }
      if (window === "none") return tStandalone("billing.sku_limit_lifetime");
      return tStandalone("billing.sku_limit_month");
    }
    case "not_new_user":
      return tStandalone("billing.sku_new_user_only");
    case "not_within_registration_window":
      return tStandalone("billing.sku_registration_window_only");
    case "audience_mismatch":
      return tStandalone("billing.sku_audience_mismatch");
    case "inactive":
      return tStandalone("billing.sku_inactive");
    case "owner_not_authorized":
      return tStandalone("billing.owner_not_authorized");
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
        message: tStandalone("billing.team_space_required"),
      };
    }
    return { ok: true, owner_type: 2, owner_id: spaceId };
  }

  return { ok: true, owner_type: 1, owner_id: 0 };
}
