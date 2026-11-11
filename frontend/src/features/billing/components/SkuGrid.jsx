import React, { useMemo, useState } from "react";
import { formatCurrencyFen, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { filterSkusByAudience, ineligibleLabel, isSkuPurchasable, skuKind } from "../lib/sku.js";

const TABS = [
  { id: "personal", label: "个人套餐" },
  { id: "team", label: "团队套餐" },
];

const KIND_SECTIONS = [
  { id: "plan", title: "周期套餐", hint: "This period’s quota has an expiry; purchase limits follow package rules." },
  { id: "topup", title: "额度充值包", hint: "永久积分，不够用时可反复购买。" },
];

function periodLabel(sku) {
  const days = Number(sku.period_days || 0);
  if (days > 0) return `/ ${days} 天`;
  return "/ 月";
}

function purchaseLimitFallback(sku) {
  const window = String(sku?.purchase_window || "")
    .trim()
    .toLowerCase();
  const limit = Number(sku?.purchase_limit || 0);
  if (!(limit > 0)) return "额度不够请买充值包；可按规则再次购买";
  if (window === "calendar_year") return `本自然年限购 ${limit} 次；额度不够请买充值包`;
  if (window === "calendar_quarter") return `本自然季限购 ${limit} 次；额度不够请买充值包`;
  if (window === "rolling_days") {
    const days = Number(sku?.purchase_window_days || 0);
    return days > 0
      ? `近 ${days} 天限购 ${limit} 次；额度不够请买充值包`
      : `已配置滚动限购 ${limit} 次；额度不够请买充值包`;
  }
  if (window === "none") return `终身限购 ${limit} 次`;
  return `本自然月限购 ${limit} 次；额度不够请买充值包`;
}

function skuHints(sku) {
  const hints = [];
  if (sku.expiry_hint) hints.push(sku.expiry_hint);
  if (sku.stacking_hint) hints.push(sku.stacking_hint);
  const reason = ineligibleLabel(sku);
  if (reason) hints.push(reason);
  if (hints.length) return hints;
  if (sku.subscription || sku.points_kind === "period" || skuKind(sku) === "plan") {
    const days = Number(sku.period_days || 30);
    return [
      `付款后 ${days} 天内有效，到期未用完作废`,
      purchaseLimitFallback(sku),
    ];
  }
  return ["永久积分，不过期", "可反复购买"];
}

function SkuCard({ sku, busy, onChoose }) {
  const isPeriod =
    skuKind(sku) === "plan" ||
    sku.subscription ||
    sku.points_kind === "period";
  const purchasable = isSkuPurchasable(sku);
  const disabled = !purchasable || busy === sku.code;
  let buttonLabel = isPeriod ? "开通本期额度" : "立即充值";
  if (busy === sku.code) buttonLabel = "正在下单…";
  else if (!purchasable) buttonLabel = ineligibleLabel(sku) || "暂不可买";

  return (
    <article
      className={`sku-card ${sku.featured ? "featured" : ""}${purchasable ? "" : " is-disabled"}`}
      aria-disabled={!purchasable}
    >
      <div className="sku-head">
        <h3>{sku.name}</h3>
        {sku.badge && <StatusBadge>{sku.badge}</StatusBadge>}
        {skuKind(sku) === "plan" && <StatusBadge tone="amber">周期</StatusBadge>}
        {skuKind(sku) === "topup" && <StatusBadge>充值包</StatusBadge>}
      </div>
      <p className="sku-price">
        {formatCurrencyFen(sku.amount_fen)}
        {isPeriod && <small>{periodLabel(sku)}</small>}
      </p>
      {sku.original_amount_fen > 0 && (
        <p className="sku-original">
          原价 {formatCurrencyFen(sku.original_amount_fen)}
        </p>
      )}
      <p className="sku-points">
        到账 {formatNumber(sku.points)} 积分
        {isPeriod ? "（本期配额）" : "（永久有效）"}
        {sku.bonus_points ? ` · 赠 ${sku.bonus_points}` : ""}
      </p>
      <ul>
        {skuHints(sku).map((hint) => (
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
          <h2>选择套餐</h2>
          <p>周期套餐按套餐规则限购；额度不够请买充值包。支付成功后自动到账。</p>
        </div>
        <div className="sku-tabs" role="tablist" aria-label="套餐类型">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "is-active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 && (
        <p className="muted">
          {tab === "team"
            ? "No team packages. Ask an admin to configure them on the workbench."
            : "No personal packages. Ask an admin to configure them on the workbench."}
        </p>
      )}
      {KIND_SECTIONS.map((section) => {
        const rows = byKind[section.id] || [];
        if (rows.length === 0) return null;
        return (
          <div className="sku-kind-block" key={section.id}>
            <div className="sku-kind-head">
              <h3>{section.title}</h3>
              <p className="muted">{section.hint}</p>
            </div>
            <div className="sku-grid">
              {rows.map((sku) => (
                <SkuCard
                  key={sku.code}
                  sku={sku}
                  busy={busy}
                  onChoose={onChoose}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
