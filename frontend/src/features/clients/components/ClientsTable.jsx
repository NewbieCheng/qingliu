import React from "react";
import { navigate } from "@/shared/router/index.js";
import { formatRelativeTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { clientNextStep } from "../clientStatus.js";

function openClient(clientId) {
  navigate(`/clients/${clientId}`);
}

export function ClientsTable({ clients }) {
  return (
    <div className="table-wrap table-compact">
      <table className="clients-table">
        <thead>
          <tr>
            <th>客户</th>
            <th>进度</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => {
            const step = clientNextStep(client);
            return (
              <tr
                key={client.id}
                className="clients-row is-clickable"
                tabIndex={0}
                role="link"
                aria-label={`打开 ${client.name}`}
                onClick={() => openClient(client.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openClient(client.id);
                  }
                }}
              >
                <td>
                  <span className="client-name">{client.name}</span>
                </td>
                <td>
                  <div className="clients-progress">
                    <StatusBadge tone={step.tone}>{step.label}</StatusBadge>
                    {step.docs > 0 && (
                      <span className="clients-progress-meta">
                        {step.docs} 份
                      </span>
                    )}
                    {step.action ? (
                      <span className="clients-progress-action">
                        {step.action}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="muted">{formatRelativeTime(client.created)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
