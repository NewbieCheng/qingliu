import React from "react";
import { Link } from "@/shared/router/index.js";
import { formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";

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
                {event.customer_id && (
                  <Link to={`/clients/${event.customer_id}`}>
                    {event.customer_id.slice(0, 8)}
                  </Link>
                )}{" "}
                {event.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 && <p className="empty">当前筛选没有操作记录。</p>}
    </div>
  );
}
