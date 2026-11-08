import React from "react";
import { Link } from "@/shared/router/index.js";
import { formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";

export function ClientsTable({ clients }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>客户代号</th>
            <th>资料</th>
            <th>处理状态</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id}>
              <td>
                <Link className="client-name" to={`/clients/${client.id}`}>
                  {client.name}
                </Link>
              </td>
              <td>{client.doc_count} 份</td>
              <td>
                <StatusBadge tone={client.running ? "amber" : "default"}>
                  {client.running
                    ? "后台处理中"
                    : client.doc_count
                      ? "打开后继续核对"
                      : "等待上传"}
                </StatusBadge>
              </td>
              <td className="muted">{formatDateTime(client.created)}</td>
              <td>
                <Link to={`/clients/${client.id}`}>打开档案 →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
