import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { navigate } from "@/shared/router/index.js";
import { formatRelativeTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { clientNextStep } from "../clientStatus.js";

function openClient(clientId) {
  navigate(`/clients/${clientId}`);
}

export function ClientsTable({ clients }) {
  const { t } = useI18n();
  return (
    <div className="table-wrap table-compact">
      <table className="clients-table">
        <thead>
          <tr>
            <th>{t("clients.col_customer")}</th>
            <th>{t("clients.col_progress")}</th>
            <th>{t("clients.col_updated")}</th>
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
                aria-label={t("clients.open_aria_label", { name: client.name })}
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
                      {t("clients.docs_count", { n: step.docs })}
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
