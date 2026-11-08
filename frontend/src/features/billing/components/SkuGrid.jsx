import React from "react";
import { formatCurrencyFen, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";

export function SkuGrid({ skus, busy, onChoose }) {
  return (
    <section className="card">
      <SectionTitle
        title="选择套餐"
        description="价格与积分由工作台后台维护，支付成功后自动到账。"
      />
      {skus.length === 0 && (
        <p className="muted">暂未配置可售套餐，请联系管理员。</p>
      )}
      <div className="sku-grid">
        {skus.map((sku) => (
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
