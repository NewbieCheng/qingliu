import React, { useMemo, useState } from "react";
import { formatCurrencyFen, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { filterSkusByAudience } from "../lib/sku.js";

const TABS = [
  { id: "personal", label: "个人套餐" },
  { id: "team", label: "团队套餐" },
];

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
        {visible.map((sku) => (
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
              {sku.subscription && <small>/ 月</small>}
            </p>
            {sku.original_amount_fen > 0 && (
              <p className="sku-original">
                原价 {formatCurrencyFen(sku.original_amount_fen)}
              </p>
            )}
            <p className="sku-points">
              {sku.subscription ? "每月 " : ""}
              {formatNumber(sku.points)} 积分
              {sku.bonus_points ? ` · 赠 ${sku.bonus_points}` : ""}
            </p>
            <ul>
              {sku.features?.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <button
              className="primary"
              disabled={busy === sku.code}
              onClick={() => onChoose(sku)}
            >
              {busy === sku.code ? "正在下单…" : "立即充值"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
