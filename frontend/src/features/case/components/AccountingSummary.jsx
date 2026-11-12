import React from "react";
import { formatCents } from "@/shared/lib/format.js";
import { AlertIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

export function AccountingSummary({ summary }) {
  const { t } = useI18n();
  const note =
    t("case.summary.note", { amount: formatCents(summary.invalid_income) });

  const stats = [
    [t("summary.raw_inflow"), summary.original_income, true],
    [t("summary.scope_excluded"), summary.scope_excluded_income, false],
    [t("summary.duplicate_quarantined"), summary.quarantined_income, false],
    [t("summary.current_inflow"), summary.income, false],
    [t("summary.included_biz"), summary.included, false],
  ];

  return (
    <section className="accounting-panel" aria-label={t("case.summary.aria_label")}>
      <div className="accounting">
        {stats.map(([title, value, withNote], index) => (
          <div key={title} className={index === 4 ? "emphasis" : ""}>
            <span className="accounting-label">
              {title}
              {withNote ? (
                <button
                  type="button"
                  className="accounting-note-tip"
                  title={note}
                  aria-label={note}
                >
                  <AlertIcon size={13} />
                </button>
              ) : null}
            </span>
            <strong>{formatCents(value)}</strong>
            <small>{t("summary.yuan")}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
