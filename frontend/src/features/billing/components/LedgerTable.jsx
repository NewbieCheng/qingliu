import { useI18n } from "@/shared/i18n/index.jsx";
import React from "react";
import { formatDateTime } from "@/shared/lib/format.js";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { ledgerChangeLabel } from "../constants.js";

export function LedgerTable({
  ledgers,
  page = 1,
  pageSize = 10,
  total = 0,
  onPageChange,
  framed = true,
  showTitle = true,
}) {
  const { t } = useI18n();
  const showHeading = framed ? showTitle : false;

  return (
    <section className={framed ? "card" : "ledger-panel"}>
      {showHeading ? (
        <SectionTitle
          title={t("billing.ledger_title")}
          description={t("billing.ledger_desc")}
        />
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("billing.ledger_time")}</th>
              <th>{t("billing.ledger_type")}</th>
              <th>{t("billing.ledger_change")}</th>
              <th>{t("billing.ledger_notes")}</th>
            </tr>
          </thead>
          <tbody>
            {ledgers.map((ledger) => {
              const isExpire = Number(ledger.change_type) === 7;
              const typeKey = ledgerChangeLabel(ledger);
              const displayedType = typeKey
                ? t(typeKey)
                : ledger?.change_type || "—";
              const reason =
                ledger.reason ||
                (isExpire ? t("billing.ledger_expire_reason") : "—");
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
      {ledgers.length === 0 && page <= 1 && (
        <p className="empty">{t("billing.ledger_empty")}</p>
      )}
      {onPageChange && (ledgers.length > 0 || page > 1) && (
        <Pagination
          page={page}
          onPrevious={() => onPageChange(page - 1)}
          onNext={() => onPageChange(page + 1)}
          canPrevious={page > 1}
          canNext={
            total > 0 ? page * pageSize < total : ledgers.length >= pageSize
          }
          label={
            total > 0
              ? t("billing.ledger_page", {
                  page,
                  pages: Math.max(1, Math.ceil(total / pageSize)),
                })
              : String(page)
          }
        />
      )}
    </section>
  );
}
