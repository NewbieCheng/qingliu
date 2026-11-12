import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Link } from "@/shared/router/index.js";
import { formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";

function AuditDetailCell({ event }) {
  const { t } = useI18n();
  const customerName = (event.customer_name || "").trim();
  const detailLabel = (event.detail_label || "").trim();
  const hasCustomer = Boolean(event.customer_id);

  if (!hasCustomer && !detailLabel) {
    return "—";
  }

  return (
    <span className="audit-detail-cell">
      {hasCustomer ? (
        <Link to={`/clients/${event.customer_id}`}>
          {customerName || t("nav.clients")}
        </Link>
      ) : null}
      {detailLabel ? (
        <span className="muted">
          {hasCustomer ? " · " : null}
          {detailLabel}
        </span>
      ) : null}
    </span>
  );
}

export function AuditLogTable({ events }) {
  const { locale } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>{copy("成员", "Member")}</th>
            <th>Actions</th>
            <th>{copy("客户 / 详情", "Customer / details")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.seq}>
              <td className="muted">{formatDateTime(event.created)}</td>
              <td>{event.display || "—"}</td>
              <td>
                <StatusBadge>{event.action_label || event.action}</StatusBadge>
              </td>
              <td>
                <AuditDetailCell event={event} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 && <p className="empty">{copy("当前筛选没有操作记录。", "No activity matches the current filters.")}</p>}
    </div>
  );
}
