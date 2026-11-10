import React from "react";
import { Link } from "@/shared/router/index.js";
import { formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";

function AuditDetailCell({ event }) {
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
          {customerName || "客户档案"}
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
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>成员</th>
            <th>操作</th>
            <th>客户 / 详情</th>
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
      {events.length === 0 && <p className="empty">当前筛选没有操作记录。</p>}
    </div>
  );
}
