import { useI18n } from "@/shared/i18n/index.jsx";
import React from "react";
import { formatCurrencyFen, formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { isExpired, orderStatusLabel, remainingText } from "../lib/order.js";

const ORDER_STATUS_EN = {
  "待支付": "Pending payment",
  "已支付": "Paid",
  "已关闭": "Closed",
  "已过期": "Expired",
};

export function OrdersTable({ orders, onResume }) {
  const { locale } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
  return (
    <section className="card">
      <SectionTitle
        title={copy("最近订单", "Recent orders")}
        description={copy("显示当前账号的充值订单；未支付订单可以重新打开二维码。", "Shows this account’s top-up orders; unpaid orders can reopen the QR code.")}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{copy("订单号", "Order #")}</th>
              <th>{copy("套餐", "Package")}</th>
              <th>{copy("金额", "Amount")}</th>
              <th>{copy("积分", "Points")}</th>
              <th>{copy("状态", "Status")}</th>
              <th>{copy("创建时间", "Created")}</th>
              <th>{copy("有效期", "Expires")}</th>
              <th>{copy("操作", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const expired = order.status === "pending" && isExpired(order);
              const status = expired ? "已过期" : orderStatusLabel(order);
              const statusLabel = locale === "en-US" ? ORDER_STATUS_EN[status] || status : status;
              return (
                <tr key={order.order_no}>
                  <td>{order.order_no}</td>
                  <td>{order.sku_name}</td>
                  <td>{formatCurrencyFen(order.amount_fen)}</td>
                  <td>
                    {Number(order.points || 0) + Number(order.bonus_points || 0)}
                  </td>
                  <td>
                    <StatusBadge tone={order.status === "paid" ? "default" : "amber"}>
                      {statusLabel}
                    </StatusBadge>
                  </td>
                  <td className="muted">{formatDateTime(order.created_at)}</td>
                  <td className="muted">
                    {order.status === "pending" && !expired
                      ? remainingText(order)
                      : formatDateTime(order.expires_at)}
                  </td>
                  <td>
                    {order.status === "pending" && !expired ? (
                      <button
                        className="ghost order-resume"
                        onClick={() => onResume(order)}
                      >
                        {copy("继续支付", "Continue payment")}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {orders.length === 0 && <p className="empty">{copy("还没有充值订单。", "No top-up orders yet.")}</p>}
    </section>
  );
}
