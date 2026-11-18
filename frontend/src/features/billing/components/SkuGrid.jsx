import React, { useMemo, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { formatCurrencyFen, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import {
  filterSkusByAudience,
  ineligibleLabel,
  isSkuPurchasable,
  skuKind,
} from "../lib/sku.js";

function periodLabel(sku, t) {
  const days = Number(sku.period_days || 0);
  if (days > 0) return t("billing.sku_per_days", { days });
  return t("billing.sku_per_month");
}

function purchaseLimitFallback(sku, t) {
  const window = String(sku?.purchase_window || "").trim().toLowerCase();
  const limit = Number(sku?.purchase_limit || 0);
  if (!(limit > 0)) return t("billing.sku_hint_buy_topup");
  if (window === "calendar_year") {
    return t("billing.sku_hint_limit_year", { limit });
  }
  if (window === "calendar_quarter") {
    return t("billing.sku_hint_limit_quarter", { limit });
  }
  if (window === "rolling_days") {
    const days = Number(sku?.purchase_window_days || 0);
    return days > 0
      ? t("billing.sku_hint_limit_rolling", { days, limit })
      : t("billing.sku_hint_limit_rolling_plain", { limit });
  }
  if (window === "none") return t("billing.sku_hint_limit_lifetime", { limit });
  return t("billing.sku_hint_limit_month", { limit });
}

function skuHints(sku, t) {
  const hints = [];
  if (sku.expiry_hint) hints.push(sku.expiry_hint);
  if (sku.stacking_hint) hints.push(sku.stacking_hint);
  const reason = ineligibleLabel(sku);
  if (reason) hints.push(reason);
  if (hints.length) return hints;
  if (
    sku.subscription ||
    sku.points_kind === "period" ||
    skuKind(sku) === "plan"
  ) {
    const days = Number(sku.period_days || 30);
    return [
      t("billing.sku_hint_valid_days", { days }),
      purchaseLimitFallback(sku, t),
    ];
  }
  return [t("billing.sku_hint_permanent"), t("billing.sku_hint_repeatable")];
}

function SkuCard({ sku, busy, onChoose, t }) {
  const isPeriod =
    skuKind(sku) === "plan" ||
    sku.subscription ||
    sku.points_kind === "period";
  const purchasable = isSkuPurchasable(sku);
  const disabled = !purchasable || busy === sku.code;
  let buttonLabel = isPeriod
    ? t("billing.sku_btn_activate")
    : t("billing.sku_btn_topup");
  if (busy === sku.code) buttonLabel = t("billing.sku_btn_ordering");
  else if (!purchasable) {
    buttonLabel = ineligibleLabel(sku) || t("billing.sku_btn_unavailable");
  }

  return (
    <article
      className={`sku-card ${sku.featured ? "featured" : ""}${purchasable ? "" : " is-disabled"}`}
      aria-disabled={!purchasable}
    >
      <div className="sku-head">
        <h3>{sku.name}</h3>
        {sku.badge && <StatusBadge>{sku.badge}</StatusBadge>}
        {skuKind(sku) === "plan" && (
          <StatusBadge tone="amber">{t("billing.sku_badge_plan")}</StatusBadge>
        )}
        {skuKind(sku) === "topup" && (
          <StatusBadge>{t("billing.sku_badge_topup")}</StatusBadge>
        )}
      </div>
      <p className="sku-price">
        {formatCurrencyFen(sku.amount_fen)}
        {isPeriod && <small>{periodLabel(sku, t)}</small>}
      </p>
      {sku.original_amount_fen > 0 && (
        <p className="sku-original">
          {t("billing.sku_list_price")}{" "}
          {formatCurrencyFen(sku.original_amount_fen)}
        </p>
      )}
      <p className="sku-points">
        {t("billing.sku_receive")} {formatNumber(sku.points)}{" "}
        {t("billing.points_unit")}
        {isPeriod
          ? t("billing.sku_period_quota")
          : t("billing.sku_permanent_valid")}
        {sku.bonus_points
          ? ` · ${t("billing.sku_bonus")} ${sku.bonus_points}`
          : ""}
      </p>
      <ul>
        {skuHints(sku, t).map((hint) => (
          <li key={hint}>{hint}</li>
        ))}
        {sku.features?.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <button
        className="primary"
        disabled={disabled}
        onClick={() => onChoose(sku)}
      >
        {buttonLabel}
      </button>
    </article>
  );
}

export function SkuGrid({ skus, busy, onChoose, defaultTab = "personal" }) {
  const { t } = useI18n();
  const initial = defaultTab === "team" ? "team" : "personal";
  const [tab, setTab] = useState(initial);
  const visible = useMemo(() => filterSkusByAudience(skus, tab), [skus, tab]);
  const byKind = useMemo(() => {
    const groups = { plan: [], topup: [] };
    for (const sku of visible) {
      groups[skuKind(sku) === "plan" ? "plan" : "topup"].push(sku);
    }
    return groups;
  }, [visible]);

  return (
    <section className="card sku-section">
      <div className="sku-section-head">
        <div className="section-title">
          <h2>{t("billing.sku_choose_title")}</h2>
          <p>{t("billing.sku_choose_desc")}</p>
        </div>
        <div
          className="sku-tabs"
          role="tablist"
          aria-label={t("billing.sku_tablist")}
        >
          {["personal", "team"].map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "is-active" : ""}
              onClick={() => setTab(id)}
            >
              {id === "team"
                ? t("billing.sku_tab_team")
                : t("billing.sku_tab_personal")}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 && (
        <p className="muted">
          {tab === "team"
            ? t("billing.sku_empty_team")
            : t("billing.sku_empty_personal")}
        </p>
      )}
      {["plan", "topup"].map((id) => {
        const rows = byKind[id] || [];
        if (rows.length === 0) return null;
        return (
          <div className="sku-kind-block" key={id}>
            <div className="sku-kind-head">
              <h3>
                {id === "plan"
                  ? t("billing.sku_kind_plan")
                  : t("billing.sku_kind_topup")}
              </h3>
              <p className="muted">
                {id === "plan"
                  ? t("billing.sku_kind_plan_desc")
                  : t("billing.sku_kind_topup_desc")}
              </p>
            </div>
            <div className="sku-grid">
              {rows.map((sku) => (
                <SkuCard
                  key={sku.code}
                  sku={sku}
                  busy={busy}
                  onChoose={onChoose}
                  t={t}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
