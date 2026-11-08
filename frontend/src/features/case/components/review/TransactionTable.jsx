import React from "react";
import { TRANSACTION_LABELS } from "@/shared/lib/constants.js";
import { formatCents } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";

function selectableRows(rows) {
  return rows.filter((row) => !row.scope_excluded && row.quality !== "invalid");
}

export function TransactionTable({ data, selected, onSelectedChange, onOpenOriginal }) {
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
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label="选择本页可处理交易"
                checked={allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
              />
            </th>
            <th>日期 / 对手方</th>
            <th>收入（元）</th>
            <th>支出（元）</th>
            <th>摘要 / 依据</th>
            <th>当前处理</th>
            <th>原件</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`选择${row.date}交易`}
                  checked={selected.includes(row.id)}
                  disabled={
                    row.scope_excluded || row.quality === "invalid" || data.busy
                  }
                  onChange={(event) => toggleOne(row.id, event.target.checked)}
                />
              </td>
              <td>
                {row.date}
                <strong className="block">
                  {row.counterparty || "原件未提供"}
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
                    ? "范围外"
                    : row.duplicate && !row.review_label
                      ? "疑似重复隔离"
                      : TRANSACTION_LABELS[row.label]}
                </StatusBadge>
              </td>
              <td>
                <button onClick={() => onOpenOriginal(row.id)}>对照原件</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
