import React from "react";
import { formatCurrencyFen, formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { isExpired, orderStatusLabel, remainingText } from "../lib/order.js";

export function OrdersTable({ orders, onResume }) {
  return (
    <section className="card">
      <SectionTitle
        title="最近订单"
        description="只显示当前账号的充值订单；待支付订单可重新打开二维码。"
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>套餐</th>
              <th>金额</th>
              <th>积分</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>有效期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const expired = order.status === "pending" && isExpired(order);
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
                      {expired ? "已过期" : orderStatusLabel(order)}
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
                        继续支付
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
      {orders.length === 0 && <p className="empty">还没有充值订单。</p>}
    </section>
  );
}
