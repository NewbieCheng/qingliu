import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { formatCurrencyFen, formatDateTime, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { CheckIcon } from "@/shared/ui/icons.jsx";
import { orderStatusLabel, remainingMs } from "../lib/order.js";

export function CheckoutPanel({ order, qr, expired, remaining, onDismiss }) {
  const { t } = useI18n();
  if (!order) return null;
  const pending = order.status === "pending";
  const paid = order.status === "paid";
  const hasMockCode = !order.code_url || order.code_url.startsWith("mock://");
  const showQr = Boolean(qr && !expired);
  const showDismiss = paid && typeof onDismiss === "function";
  const statusKey = orderStatusLabel(order);
  const statusLabel = statusKey ? t(statusKey) : order.status || "";

  return (
    <section
      className={`card checkout${paid ? " checkout--paid" : ""}`}
      aria-live={paid ? "polite" : undefined}
    >
      <div className="checkout-main">
        <p className="eyebrow">
          {t("billing.checkout_order")} {order.order_no}
        </p>
        <h2>{order.sku_name}</h2>
        <p className="muted">
          {formatCurrencyFen(order.amount_fen)} ·{" "}
          {formatNumber(order.points, "0")} {t("billing.points_unit")}
          {order.bonus_points ? ` + ${order.bonus_points}` : ""}
        </p>
        <StatusBadge tone={paid ? "default" : "amber"}>
          {statusLabel}
        </StatusBadge>
        {pending && !expired && (
          <p className="checkout-expiry">
            {t("billing.qr_valid_until")} {formatDateTime(order.expires_at)} ·{" "}
            {t("billing.remaining")}{" "}
            <strong>{remaining}</strong>
            {remainingMs(order) <= 5 * 60 * 1000 && (
              <span className="checkout-expiry-warning">
                {t("billing.expiring_soon")}
              </span>
            )}
          </p>
        )}
        {pending && !expired && !hasMockCode && (
          <p className="muted">{t("billing.pay_wechat_hint")}</p>
        )}
        {pending && !expired && hasMockCode && (
          <p className="muted">{t("billing.pay_manual_hint")}</p>
        )}
        {expired && <p className="error">{t("billing.qr_expired")}</p>}
        {paid && (
          <p className="checkout-result-lead">
            <span className="checkout-result-mark" aria-hidden="true">
              <CheckIcon size={14} />
            </span>
            {t("billing.points_received")}
          </p>
        )}
        {order.status === "closed" && !expired && (
          <p className="muted">{t("billing.order_closed")}</p>
        )}
      </div>
      {(showQr || showDismiss) && (
        <div className="checkout-aside">
          {showQr && (
            <img
              className="checkout-qr"
              src={qr}
              alt={t("billing.wechat_qr_alt")}
            />
          )}
          {showDismiss && (
            <button
              type="button"
              className="primary checkout-done"
              onClick={onDismiss}
            >
              {t("billing.checkout_done")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
