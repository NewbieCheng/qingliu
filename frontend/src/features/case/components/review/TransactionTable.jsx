import React, { useState } from "react";
import { TRANSACTION_LABELS } from "@/shared/lib/constants.js";
import { formatCents } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { aiStatusLabel } from "../../lib/ai-adopt.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import { addTransaction, deleteTransaction } from "../../api.js";
import "./review-actions.css";

function selectableRows(rows) {
  return rows.filter((row) => !row.scope_excluded && row.quality !== "invalid");
}

export function TransactionTable({ data, selected, onSelectedChange, onChanged }) {
  const { t } = useI18n();
  const selectable = selectableRows(data.rows);
  const allSelected =
    selected.length > 0 && selected.length === selectable.length;
  // 待确认删除的行：删交易会影响核对口径，必须二次确认。
  const [pendingDelete, setPendingDelete] = useState(null);
  // 手工新增表单。
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    date: "",
    direction: "income",
    amount: "",
    counterparty: "",
    memo: "",
  });
  const [busy, setBusy] = useState(false);

  function toggleAll(checked) {
    onSelectedChange(checked ? selectable.map((row) => row.id) : []);
  }

  function toggleOne(id, checked) {
    onSelectedChange(
      checked ? [...selected, id] : selected.filter((value) => value !== id),
    );
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await deleteTransaction(data.cid, pendingDelete.id);
      toast(t("review.delete_success"));
      setPendingDelete(null);
      onChanged?.();
    } catch (error) {
      toast(error.message || t("review.delete_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await addTransaction(data.cid, draft);
      toast(t("review.add_success"));
      setAdding(false);
      setDraft({ date: "", direction: "income", amount: "", counterparty: "", memo: "" });
      onChanged?.();
    } catch (error) {
      toast(error.message || t("review.add_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tx-block">
      <div className="tx-actions">
        <button
          type="button"
          className="btn-outline"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? t("common.cancel") : t("review.add_row")}
        </button>
      </div>

      {adding ? (
        <form className="tx-add-form" onSubmit={submitAdd}>
          <input
            type="date"
            required
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            aria-label={t("review.col_date")}
          />
          <select
            value={draft.direction}
            onChange={(e) => setDraft({ ...draft, direction: e.target.value })}
            aria-label={t("review.col_direction")}
          >
            <option value="income">{t("review.direction_income")}</option>
            <option value="expense">{t("review.direction_expense")}</option>
          </select>
          <input
            type="text"
            inputMode="decimal"
            required
            placeholder={t("review.amount_placeholder")}
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          />
          <input
            type="text"
            placeholder={t("review.counterparty_placeholder")}
            value={draft.counterparty}
            onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })}
          />
          <input
            type="text"
            placeholder={t("review.memo_placeholder")}
            value={draft.memo}
            onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
          />
          <button type="submit" className="btn-outline-warning" disabled={busy}>
            {busy ? t("review.saving") : t("review.save_row")}
          </button>
        </form>
      ) : null}

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
            <th className="tx-col-actions">{t("clients.col_actions")}</th>
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
                    ? t("summary.scope_excluded")
                    : row.duplicate && !row.review_label
                      ? t("case.review.duplicate_quarantined")
                      : t(TRANSACTION_LABELS[row.label] || "label.pending")}
                </StatusBadge>
              </td>
              <td>
                <button
                  type="button"
                  className="btn-outline-danger"
                  disabled={busy}
                  title={t("review.delete_hint")}
                  onClick={() => setPendingDelete(row)}
                >
                  {t("review.delete_row")}
                </button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {pendingDelete ? (
        <div className="confirm-backdrop" role="dialog" aria-modal="true">
          <div className="confirm-card">
            <h3>{t("review.delete_confirm_title")}</h3>
            <p>
              {pendingDelete.date} · {pendingDelete.counterparty || "—"} ·{" "}
              {formatCents(pendingDelete.income !== 0 ? pendingDelete.income : pendingDelete.expense)}
            </p>
            <div className="confirm-actions">
              <button type="button" className="ghost" onClick={() => setPendingDelete(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn-outline-danger"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {busy ? t("review.deleting") : t("review.delete_confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
