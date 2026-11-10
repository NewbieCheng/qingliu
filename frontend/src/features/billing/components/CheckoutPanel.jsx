import React from "react";
import { formatCurrencyFen, formatDateTime, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { CheckIcon } from "@/shared/ui/icons.jsx";
import { orderStatusLabel, remainingMs } from "../lib/order.js";

export function CheckoutPanel({ order, qr, expired, remaining, onDismiss }) {
  if (!order) return null;
  const pending = order.status === "pending";
  const paid = order.status === "paid";
  const hasMockCode = !order.code_url || order.code_url.startsWith("mock://");
  const showQr = Boolean(qr && !expired);
  const showDismiss = paid && typeof onDismiss === "function";

  return (
    <section
      className={`card checkout${paid ? " checkout--paid" : ""}`}
      aria-live={paid ? "polite" : undefined}
    >
      <div className="checkout-main">
        <p className="eyebrow">订单 {order.order_no}</p>
        <h2>{order.sku_name}</h2>
        <p className="muted">
          {formatCurrencyFen(order.amount_fen)} ·{" "}
          {formatNumber(order.points, "0")} 积分
          {order.bonus_points ? ` + ${order.bonus_points}` : ""}
        </p>
        <StatusBadge tone={paid ? "default" : "amber"}>
          {orderStatusLabel(order)}
        </StatusBadge>
        {pending && !expired && (
          <p className="checkout-expiry">
            二维码有效期至 {formatDateTime(order.expires_at)} · 剩余{" "}
            <strong>{remaining}</strong>
            {remainingMs(order) <= 5 * 60 * 1000 && (
              <span className="checkout-expiry-warning"> 即将过期</span>
            )}
          </p>
        )}
        {pending && !expired && !hasMockCode && (
          <p className="muted">
            请使用微信扫码支付。刷新页面不会丢失订单，可回到「最近订单」继续支付。
          </p>
        )}
        {pending && !expired && hasMockCode && (
          <p className="muted">
            当前为人工/测试通道。请把订单号发给管理员确认到账。
          </p>
        )}
        {expired && (
          <p className="error">
            二维码已过期，订单已关闭。请重新选择套餐下单。
          </p>
        )}
        {paid && (
          <p className="checkout-result-lead">
            <span className="checkout-result-mark" aria-hidden="true">
              <CheckIcon size={14} />
            </span>
            积分已到账，余额已刷新。
          </p>
        )}
        {order.status === "closed" && !expired && (
          <p className="muted">订单已关闭，请重新选择套餐下单。</p>
        )}
      </div>
      {(showQr || showDismiss) && (
        <div className="checkout-aside">
          {showQr && (
            <img className="checkout-qr" src={qr} alt="微信支付二维码" />
          )}
          {showDismiss && (
            <button
              type="button"
              className="primary checkout-done"
              onClick={onDismiss}
            >
              完成
            </button>
          )}
        </div>
      )}
    </section>
  );
}
