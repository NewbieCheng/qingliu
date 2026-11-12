import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { formatCurrencyFen, formatDateTime, formatNumber } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { CheckIcon } from "@/shared/ui/icons.jsx";
import { orderStatusLabel, remainingMs } from "../lib/order.js";

const ORDER_STATUS_EN = {
  "待支付": "Pending payment",
  "已支付": "Paid",
  "已关闭": "Closed",
  "已过期": "Expired",
};

export function CheckoutPanel({ order, qr, expired, remaining, onDismiss }) {
  const { locale } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
  if (!order) return null;
  const pending = order.status === "pending";
  const paid = order.status === "paid";
  const hasMockCode = !order.code_url || order.code_url.startsWith("mock://");
  const showQr = Boolean(qr && !expired);
  const showDismiss = paid && typeof onDismiss === "function";
  const status = orderStatusLabel(order);
  const statusLabel = locale === "en-US" ? ORDER_STATUS_EN[status] || status : status;

  return (
    <section
      className={`card checkout${paid ? " checkout--paid" : ""}`}
      aria-live={paid ? "polite" : undefined}
    >
      <div className="checkout-main">
        <p className="eyebrow">{copy("订单", "Order")} {order.order_no}</p>
        <h2>{order.sku_name}</h2>
        <p className="muted">
          {formatCurrencyFen(order.amount_fen)} ·{" "}
          {formatNumber(order.points, "0")} {copy("积分", "points")}
          {order.bonus_points ? ` + ${order.bonus_points}` : ""}
        </p>
        <StatusBadge tone={paid ? "default" : "amber"}>
          {statusLabel}
        </StatusBadge>
        {pending && !expired && (
          <p className="checkout-expiry">
            {copy("二维码有效期至", "QR code valid until")} {formatDateTime(order.expires_at)} · {copy("剩余", "Remaining")}{" "}
            <strong>{remaining}</strong>
            {remainingMs(order) <= 5 * 60 * 1000 && (
              <span className="checkout-expiry-warning">{copy(" 即将过期", " Expiring soon")}</span>
            )}
          </p>
        )}
        {pending && !expired && !hasMockCode && (
          <p className="muted">
            {copy("请使用微信扫码支付。刷新页面不会丢失订单，可回到「最近订单」继续支付。", "Scan with WeChat to pay. Refreshing will not lose the order; return to Recent orders to continue payment.")}
          </p>
        )}
        {pending && !expired && hasMockCode && (
          <p className="muted">
            {copy("当前为人工/测试通道。请把订单号发给管理员确认到账。", "This is a manual/test payment channel. Send the order number to an administrator to confirm receipt.")}
          </p>
        )}
        {expired && (
          <p className="error">
            {copy("二维码已过期，订单已关闭。请重新选择套餐下单。", "The QR code has expired and the order is closed. Select a package to place a new order.")}
          </p>
        )}
        {paid && (
          <p className="checkout-result-lead">
            <span className="checkout-result-mark" aria-hidden="true">
              <CheckIcon size={14} />
            </span>
            {copy("积分已到账，余额已刷新。", "Points received. The balance has been refreshed.")}
          </p>
        )}
        {order.status === "closed" && !expired && (
          <p className="muted">{copy("订单已关闭，请重新选择套餐下单。", "The order is closed. Select a package to place a new order.")}</p>
        )}
      </div>
      {(showQr || showDismiss) && (
        <div className="checkout-aside">
          {showQr && (
            <img className="checkout-qr" src={qr} alt={copy("微信支付二维码", "WeChat Pay QR code")} />
          )}
          {showDismiss && (
            <button
              type="button"
              className="primary checkout-done"
              onClick={onDismiss}
            >
              {copy("完成", "Done")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
