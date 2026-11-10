import React from "react";
import { formatDateTime } from "@/shared/lib/format.js";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { ledgerChangeLabel } from "../constants.js";

export function LedgerTable({ ledgers, page = 1, pageSize = 10, total = 0, onPageChange }) {
  return (
    <section className="card">
      <SectionTitle
        title="积分流水"
        description="充值与 AI 消耗都在这里留痕。"
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>变动</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {ledgers.map((ledger) => {
              const isExpire = Number(ledger.change_type) === 7;
              const reason =
                ledger.reason ||
                (isExpire ? "本期额度到期未用完，已作废" : "—");
              return (
                <tr
                  key={ledger.ledger_id}
                  className={isExpire ? "ledger-expire" : undefined}
                >
                  <td className="muted">
                    {formatDateTime(ledger.occurred_at || ledger.created_at)}
                  </td>
                  <td>{ledgerChangeLabel(ledger)}</td>
                  <td
                    className={
                      ledger.points_delta >= 0
                        ? "number positive"
                        : isExpire
                          ? "number ledger-expire-delta"
                          : "number"
                    }
                  >
                    {ledger.points_delta >= 0 ? "+" : ""}
                    {ledger.points_delta}
                  </td>
                  <td>{reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ledgers.length === 0 && page <= 1 && <p className="empty">还没有积分流水。</p>}
      {onPageChange && (ledgers.length > 0 || page > 1) && (
        <Pagination
          page={page}
          onPrevious={() => onPageChange(page - 1)}
          onNext={() => onPageChange(page + 1)}
          canPrevious={page > 1}
          canNext={total > 0 ? page * pageSize < total : ledgers.length >= pageSize}
          label={total > 0 ? `第 ${page} 页 / 共 ${total} 条` : `第 ${page} 页`}
        />
      )}
    </section>
  );
}
