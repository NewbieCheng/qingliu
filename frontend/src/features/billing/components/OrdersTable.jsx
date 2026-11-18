import { useI18n } from "@/shared/i18n/index.jsx";
import React from "react";
import { formatCurrencyFen, formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { isExpired, orderStatusLabel, remainingText } from "../lib/order.js";

export function OrdersTable({ orders, onResume }) {
  const { t } = useI18n();
  return (
    <section className="card">
      <SectionTitle
        title={t("billing.orders_title")}
        description={t("billing.orders_desc")}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("billing.col_order_no")}</th>
              <th>{t("billing.col_sku")}</th>
              <th>{t("billing.col_amount")}</th>
              <th>{t("billing.points_unit")}</th>
              <th>{t("billing.col_status")}</th>
              <th>{t("billing.col_created")}</th>
              <th>{t("billing.col_expires")}</th>
              <th>{t("billing.col_actions")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const expired = order.status === "pending" && isExpired(order);
              const statusKey = expired
                ? "billing.order_status.expired"
                : orderStatusLabel(order);
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
                      {statusKey ? t(statusKey) : order.status || "—"}
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
                        {t("billing.resume_pay")}
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
      {orders.length === 0 && (
        <p className="empty">{t("billing.orders_empty")}</p>
      )}
    </section>
  );
}
