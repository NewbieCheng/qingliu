import React from "react";
import { TRANSACTION_LABELS } from "@/shared/lib/constants.js";
import { formatCents } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { aiStatusLabel } from "../../lib/ai-adopt.js";
import { useI18n } from "@/shared/i18n/index.jsx";

function selectableRows(rows) {
  return rows.filter((row) => !row.scope_excluded && row.quality !== "invalid");
}

export function TransactionTable({ data, selected, onSelectedChange, onOpenOriginal }) {
  const { t } = useI18n();
  const selectable = selectableRows(data.rows);
  const allSelected =
    selected.length > 0 && selected.length === selectable.length;

  function toggleAll(checked) {
    onSelectedChange(checked ? selectable.map((row) => row.id) : []);
  }

  function toggleOne(id, checked) {
    onSelectedChange(
      checked ? [...selected, id] : selected.filter((value) => value !== id),
    );
  }

  return (
    <div className="table-wrap table-compact">
      <table>
        <thead>
          <tr>
            <th
              title={
                selectable.length === 0
                  ? t("case.review.no_selectable_title")
                  : undefined
              }
            >
              <input
                type="checkbox"
                aria-label={t("review.col_check")}
                checked={allSelected}
                disabled={selectable.length === 0 || data.busy}
                title={
                  selectable.length === 0
                    ? t("case.review.no_selectable")
                    : data.busy
                      ? t("case.review.busy")
                      : undefined
                }
                onChange={(event) => toggleAll(event.target.checked)}
              />
            </th>
            <th>{t("review.col_date_party")}</th>
            <th>{t("review.col_income")}</th>
            <th>{t("review.col_expense")}</th>
            <th>{t("review.col_memo")}</th>
            <th>{t("review.col_status")}</th>
            <th>{t("review.col_original")}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const blocked =
              row.scope_excluded || row.quality === "invalid" || data.busy;
            const blockReason = row.scope_excluded
              ? row.scope_reason || t("case.review.out_of_range_reason")
              : row.quality === "invalid"
                ? t("case.review.invalid_transaction")
                : data.busy
                  ? t("case.review.busy_not_selectable")
                  : undefined;
            return (
            <tr key={row.id}>
              <td title={blockReason}>
                <input
                  type="checkbox"
                  aria-label={t("case.review.select_transaction", { date: row.date })}
                  title={blockReason}
                  checked={selected.includes(row.id)}
                  disabled={blocked}
                  onChange={(event) => toggleOne(row.id, event.target.checked)}
                />
              </td>
              <td>
                {row.date}
                <strong className="block">
                  {row.counterparty || t("review.original_not_provided")}
                </strong>
              </td>
              <td className="number">{formatCents(row.income)}</td>
              <td className="number">{formatCents(row.expense)}</td>
              <td>
                {row.memo}
                <small className="block">
                  {row.reason} · {row.rule_id}
                </small>
                {row.alerts?.map((alert) => (
                  <StatusBadge tone="amber" key={alert}>
                    {alert}
                  </StatusBadge>
                ))}
                {aiStatusLabel(row) ? (
                  <StatusBadge
                    tone={row.ai_status === "adopted" ? "default" : "amber"}
                    key="ai"
                  >
                    {aiStatusLabel(row)}
                  </StatusBadge>
                ) : null}
              </td>
              <td>
                <StatusBadge
                  tone={
                    row.label === "pending" || row.quality === "invalid"
                      ? "amber"
                      : "default"
                  }
                >
                  {row.scope_excluded
                    ? "Out of range"
                    : row.duplicate && !row.review_label
                      ? t("case.review.duplicate_quarantined")
                      : TRANSACTION_LABELS[row.label]}
                </StatusBadge>
              </td>
              <td>
                <button onClick={() => onOpenOriginal(row.id)}>{t("review.btn_view_original")}</button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
