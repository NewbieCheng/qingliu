import React, { useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { navigate } from "@/shared/router/index.js";
import { formatRelativeTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { clientNextStep } from "../clientStatus.js";
import { deleteClient } from "../api.js";

function openClient(clientId) {
  navigate(`/clients/${clientId}`);
}

export function ClientsTable({ clients, canDelete = false, onDeleted }) {
  const { t } = useI18n();
  // 待确认删除的客户：二次确认，避免误点把整份档案连原件一起删掉。
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState("");

  async function confirmDelete() {
    if (!pending) return;
    setBusy(pending.id);
    try {
      await deleteClient(pending.id);
      toast(t("clients.delete_success", { name: pending.name }));
      setPending(null);
      onDeleted?.();
    } catch (error) {
      toast(error.message || t("clients.delete_failed"), "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="table-wrap table-compact">
        <table className="clients-table">
          <thead>
            <tr>
              <th>{t("clients.col_customer")}</th>
              <th>{t("clients.col_progress")}</th>
              <th>{t("clients.col_updated")}</th>
              {canDelete ? (
                <th className="clients-col-actions">{t("clients.col_actions")}</th>
              ) : null}
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
                      <StatusBadge tone={step.tone}>{t(step.labelKey)}</StatusBadge>
                      {step.docs > 0 && (
                        <span className="clients-progress-meta">
          {t("clients.docs_count", { n: step.docs })}
                        </span>
                      )}
                      {step.action ? (
                        <span className="clients-progress-action">
                          {t(step.actionKey)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="muted">{formatRelativeTime(client.created)}</td>
                  {canDelete ? (
                    <td className="clients-col-actions">
                      <button
                        type="button"
                        className="btn-outline-danger"
                        disabled={busy === client.id}
                        title={t("clients.delete_hint")}
                        onClick={(event) => {
                          // 行本身可点进详情，删除按钮必须阻止冒泡。
                          event.stopPropagation();
                          setPending(client);
                        }}
                      >
                        {busy === client.id ? t("clients.deleting") : t("clients.delete")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pending ? (
        <div className="confirm-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-card">
            <h3>{t("clients.delete_confirm_title", { name: pending.name })}</h3>
            <p>{t("clients.delete_confirm_body")}</p>
            <div className="confirm-actions">
              <button type="button" className="ghost" onClick={() => setPending(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn-outline-danger"
                disabled={busy === pending.id}
                onClick={() => void confirmDelete()}
              >
                {busy === pending.id ? t("clients.deleting") : t("clients.delete_confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
