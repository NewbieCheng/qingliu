import React from "react";
import { formatCurrencyFen, formatDateTime, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { orderStatusLabel, remainingMs } from "../lib/order.js";

export function CheckoutPanel({ order, qr, expired, remaining }) {
  if (!order) return null;
  const pending = order.status === "pending";
  const hasMockCode = !order.code_url || order.code_url.startsWith("mock://");

  return (
    <section className="card checkout">
      <div className="checkout-main">
        <p className="eyebrow">订单 {order.order_no}</p>
        <h2>{order.sku_name}</h2>
        <p className="muted">
          {formatCurrencyFen(order.amount_fen)} ·{" "}
          {formatNumber(order.points, "0")} 积分
          {order.bonus_points ? ` + ${order.bonus_points}` : ""}
        </p>
        <StatusBadge tone={order.status === "paid" ? "default" : "amber"}>
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
        {order.status === "paid" && (
          <p className="success">积分已到账，余额已刷新。</p>
        )}
        {order.status === "closed" && !expired && (
          <p className="muted">订单已关闭，请重新选择套餐下单。</p>
        )}
      </div>
      {qr && !expired && (
        <img className="checkout-qr" src={qr} alt="微信支付二维码" />
      )}
    </section>
  );
}
