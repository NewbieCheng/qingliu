import { useMemo, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { formatCurrencyFen, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { filterSkusByAudience, ineligibleLabel, isSkuPurchasable, skuKind } from "../lib/sku.js";

function copy(locale, zh, en) {
  return locale === "en-US" ? en : zh;
}

function periodLabel(sku, locale) {
  const days = Number(sku.period_days || 0);
  if (days > 0) return locale === "en-US" ? `/ ${days} days` : `/ ${days} 天`;
  return locale === "en-US" ? "/ month" : "/ 月";
}

function purchaseLimitFallback(sku, locale) {
  const window = String(sku?.purchase_window || "").trim().toLowerCase();
  const limit = Number(sku?.purchase_limit || 0);
  if (!(limit > 0)) return copy(locale, "额度不够请买充值包；可按规则再次购买", "Buy a top-up package if you need more points; repurchase is subject to package rules.");
  if (window === "calendar_year") return copy(locale, `本自然年限购 ${limit} 次；额度不够请买充值包`, `Limit: ${limit} purchase(s) per calendar year. Buy a top-up package if you need more points.`);
  if (window === "calendar_quarter") return copy(locale, `本自然季限购 ${limit} 次；额度不够请买充值包`, `Limit: ${limit} purchase(s) per calendar quarter. Buy a top-up package if you need more points.`);
  if (window === "rolling_days") {
    const days = Number(sku?.purchase_window_days || 0);
    return days > 0
      ? copy(locale, `近 ${days} 天限购 ${limit} 次；额度不够请买充值包`, `Limit: ${limit} purchase(s) every ${days} days. Buy a top-up package if you need more points.`)
      : copy(locale, `已配置滚动限购 ${limit} 次；额度不够请买充值包`, `Rolling purchase limit: ${limit}. Buy a top-up package if you need more points.`);
  }
  if (window === "none") return copy(locale, `终身限购 ${limit} 次`, `Lifetime limit: ${limit} purchase(s).`);
  return copy(locale, `本自然月限购 ${limit} 次；额度不够请买充值包`, `Limit: ${limit} purchase(s) per calendar month. Buy a top-up package if you need more points.`);
}

function skuHints(sku, locale) {
  const hints = [];
  if (sku.expiry_hint) hints.push(sku.expiry_hint);
  if (sku.stacking_hint) hints.push(sku.stacking_hint);
  const reason = ineligibleLabel(sku);
  if (reason) hints.push(reason);
  if (hints.length) return hints;
  if (sku.subscription || sku.points_kind === "period" || skuKind(sku) === "plan") {
    const days = Number(sku.period_days || 30);
    return [
      copy(locale, `付款后 ${days} 天内有效，到期未用完作废`, `Valid for ${days} days after payment; unused points expire.`),
      purchaseLimitFallback(sku, locale),
    ];
  }
  return [copy(locale, "永久积分，不过期", "Permanent points; no expiry."), copy(locale, "可反复购买", "Available for repeat purchase.")];
}

function SkuCard({ sku, busy, onChoose, locale }) {
  const isPeriod = skuKind(sku) === "plan" || sku.subscription || sku.points_kind === "period";
  const purchasable = isSkuPurchasable(sku);
  const disabled = !purchasable || busy === sku.code;
  let buttonLabel = isPeriod ? copy(locale, "开通本期额度", "Activate plan") : copy(locale, "立即充值", "Top up now");
  if (busy === sku.code) buttonLabel = copy(locale, "正在下单…", "Placing order…");
  else if (!purchasable) buttonLabel = ineligibleLabel(sku) || copy(locale, "暂不可买", "Unavailable");

  return (
    <article className={`sku-card ${sku.featured ? "featured" : ""}${purchasable ? "" : " is-disabled"}`} aria-disabled={!purchasable}>
      <div className="sku-head">
        <h3>{sku.name}</h3>
        {sku.badge && <StatusBadge>{sku.badge}</StatusBadge>}
        {skuKind(sku) === "plan" && <StatusBadge tone="amber">{copy(locale, "周期", "Plan")}</StatusBadge>}
        {skuKind(sku) === "topup" && <StatusBadge>{copy(locale, "充值包", "Top-up")}</StatusBadge>}
      </div>
      <p className="sku-price">{formatCurrencyFen(sku.amount_fen)}{isPeriod && <small>{periodLabel(sku, locale)}</small>}</p>
      {sku.original_amount_fen > 0 && <p className="sku-original">{copy(locale, "原价", "List price")} {formatCurrencyFen(sku.original_amount_fen)}</p>}
      <p className="sku-points">
        {copy(locale, "到账", "Receive")} {formatNumber(sku.points)} {copy(locale, "积分", "points")}
        {isPeriod ? copy(locale, "（本期配额）", " (current-period quota)") : copy(locale, "（永久有效）", " (no expiry)")}
        {sku.bonus_points ? ` · ${copy(locale, "赠", "bonus")} ${sku.bonus_points}` : ""}
      </p>
      <ul>
        {skuHints(sku, locale).map((hint) => <li key={hint}>{hint}</li>)}
        {sku.features?.map((feature) => <li key={feature}>{feature}</li>)}
      </ul>
      <button className="primary" disabled={disabled} onClick={() => onChoose(sku)}>{buttonLabel}</button>
    </article>
  );
}

export function SkuGrid({ skus, busy, onChoose, defaultTab = "personal" }) {
  const { locale } = useI18n();
  const initial = defaultTab === "team" ? "team" : "personal";
  const [tab, setTab] = useState(initial);
  const visible = useMemo(() => filterSkusByAudience(skus, tab), [skus, tab]);
  const byKind = useMemo(() => {
    const groups = { plan: [], topup: [] };
    for (const sku of visible) groups[skuKind(sku) === "plan" ? "plan" : "topup"].push(sku);
    return groups;
  }, [visible]);

  return (
    <section className="card sku-section">
      <div className="sku-section-head">
        <div className="section-title">
          <h2>{copy(locale, "选择套餐", "Choose a package")}</h2>
          <p>{copy(locale, "周期套餐按套餐规则限购；额度不够请买充值包。支付成功后自动到账。", "Plan purchases follow package limits. Buy a top-up package if you need more points. Successful payments are credited automatically.")}</p>
        </div>
        <div className="sku-tabs" role="tablist" aria-label={copy(locale, "套餐类型", "Package type")}>
          {["personal", "team"].map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{id === "team" ? copy(locale, "团队套餐", "Team packages") : copy(locale, "个人套餐", "Personal packages")}</button>)}
        </div>
      </div>
      {visible.length === 0 && <p className="muted">{tab === "team" ? copy(locale, "暂无可用团队套餐，请联系管理员在工作台配置。", "No team packages are available. Ask an admin to configure them in the Workbench.") : copy(locale, "暂无可用个人套餐，请联系管理员在工作台配置。", "No personal packages are available. Ask an admin to configure them in the Workbench.")}</p>}
      {["plan", "topup"].map((id) => {
        const rows = byKind[id] || [];
        if (rows.length === 0) return null;
        return <div className="sku-kind-block" key={id}>
          <div className="sku-kind-head">
            <h3>{id === "plan" ? copy(locale, "周期套餐", "Plans") : copy(locale, "额度充值包", "Top-up packages")}</h3>
            <p className="muted">{id === "plan" ? copy(locale, "本期额度有有效期；购买次数按套餐规则限制。", "This period’s quota expires; purchase limits follow package rules.") : copy(locale, "永久积分，不够用时可反复购买。", "Permanent points; purchase again whenever you need more.")}</p>
          </div>
          <div className="sku-grid">{rows.map((sku) => <SkuCard key={sku.code} sku={sku} busy={busy} onChoose={onChoose} locale={locale} />)}</div>
        </div>;
      })}
    </section>
  );
}
