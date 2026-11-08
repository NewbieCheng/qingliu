import React from "react";
import { formatDateTime } from "@/shared/lib/format.js";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { LEDGER_CHANGE } from "../constants.js";

export function LedgerTable({ ledgers }) {
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
            {ledgers.map((ledger) => (
              <tr key={ledger.ledger_id}>
                <td className="muted">
                  {formatDateTime(ledger.occurred_at || ledger.created_at)}
                </td>
                <td>{LEDGER_CHANGE[ledger.change_type] || ledger.change_type}</td>
                <td
                  className={
                    ledger.points_delta >= 0 ? "number positive" : "number"
                  }
                >
                  {ledger.points_delta >= 0 ? "+" : ""}
                  {ledger.points_delta}
                </td>
                <td>{ledger.reason || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ledgers.length === 0 && <p className="empty">还没有积分流水。</p>}
    </section>
  );
}
