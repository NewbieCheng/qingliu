import { useI18n } from "@/shared/i18n/index.jsx";
import React from "react";
import { formatDateTime } from "@/shared/lib/format.js";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { ledgerChangeLabel } from "../constants.js";

const LEDGER_LABEL_EN = {
  注册赠送: "Registration bonus",
  套餐发放: "Package allocation",
  "AI 消耗": "AI usage",
  人工调整: "Manual adjustment",
  预授权退回: "Preauthorization refund",
  充值到账: "Top-up credited",
  临时积分到期作废: "Temporary points expired",
  "订阅到账（临时）": "Subscription credited (temporary)",
  "临时积分变动": "Temporary points adjustment",
  "充值到账（永久）": "Top-up credited (permanent)",
  "AI 消耗（含临时）": "AI usage (including temporary points)",
};

export function LedgerTable({ ledgers, page = 1, pageSize = 10, total = 0, onPageChange }) {
  const { locale, t } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
  return (
    <section className="card">
      <SectionTitle
        title={copy("积分流水", "Points ledger")}
        description={copy("充值与 AI 消耗都在这里留痕。", "Top-ups and AI usage are recorded here.")}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>{copy("变动", "Change")}</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {ledgers.map((ledger) => {
              const isExpire = Number(ledger.change_type) === 7;
              const typeLabel = ledgerChangeLabel(ledger);
              const displayedType = locale === "en-US" ? LEDGER_LABEL_EN[typeLabel] || typeLabel : typeLabel;
              const reason =
                ledger.reason ||
                (isExpire ? copy("临时积分到期未用完，已作废", "Unused temporary points expired and were forfeited.") : "—");
              return (
                <tr
                  key={ledger.ledger_id}
                  className={isExpire ? "ledger-expire" : undefined}
                >
                  <td className="muted">
                    {formatDateTime(ledger.occurred_at || ledger.created_at)}
                  </td>
                  <td>{displayedType}</td>
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
      {ledgers.length === 0 && page <= 1 && <p className="empty">{copy("还没有积分流水。", "No points ledger entries yet.")}</p>}
      {onPageChange && (ledgers.length > 0 || page > 1) && (
        <Pagination
          page={page}
          onPrevious={() => onPageChange(page - 1)}
          onNext={() => onPageChange(page + 1)}
          canPrevious={page > 1}
          canNext={total > 0 ? page * pageSize < total : ledgers.length >= pageSize}
          label={total > 0 ? copy(`第 ${page} 页 / 共 ${total} 条`, `Page ${page} / ${total} entries`) : t("common.page", { page })}
        />
      )}
    </section>
  );
}
