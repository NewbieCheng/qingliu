import React, { useMemo, useState } from "react";
import { formatCurrencyFen, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { filterSkusByAudience } from "../lib/sku.js";

const TABS = [
  { id: "personal", label: "个人套餐" },
  { id: "team", label: "团队套餐" },
];

function periodLabel(sku) {
  const days = Number(sku.period_days || 0);
  if (days > 0) return `/ ${days} 天`;
  return "/ 月";
}

function skuHints(sku) {
  const hints = [];
  if (sku.expiry_hint) hints.push(sku.expiry_hint);
  if (sku.stacking_hint) hints.push(sku.stacking_hint);
  if (hints.length) return hints;
  if (sku.subscription || sku.points_kind === "period") {
    const days = Number(sku.period_days || 30);
    return [
      `付款后 ${days} 天内有效，到期未用完作废`,
      "再次购买将累加额度，并延长至更晚的到期日",
    ];
  }
  return ["永久积分，不过期"];
}

export function SkuGrid({ skus, busy, onChoose, defaultTab = "personal" }) {
  const initial = defaultTab === "team" ? "team" : "personal";
  const [tab, setTab] = useState(initial);
  const visible = useMemo(() => filterSkusByAudience(skus, tab), [skus, tab]);

  return (
    <section className="card sku-section">
      <div className="sku-section-head">
        <div className="section-title">
          <h2>选择套餐</h2>
          <p>价格与积分由工作台后台维护，支付成功后自动到账。</p>
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
            ? "暂无团队套餐，请联系管理员在工作台配置。"
            : "暂无个人套餐，请联系管理员在工作台配置。"}
        </p>
      )}
      <div className="sku-grid">
        {visible.map((sku) => {
          const isPeriod =
            sku.subscription || sku.points_kind === "period";
          return (
            <article
              className={`sku-card ${sku.featured ? "featured" : ""}`}
              key={sku.code}
            >
              <div className="sku-head">
                <h3>{sku.name}</h3>
                {sku.badge && <StatusBadge>{sku.badge}</StatusBadge>}
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
                {isPeriod ? "到账 " : "到账 "}
                {formatNumber(sku.points)} 积分
                {isPeriod ? "（本期额度）" : "（永久有效）"}
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
                disabled={busy === sku.code}
                onClick={() => onChoose(sku)}
              >
                {busy === sku.code
                  ? "正在下单…"
                  : isPeriod
                    ? "开通 / 续费"
                    : "立即充值"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
