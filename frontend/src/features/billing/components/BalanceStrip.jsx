import React from "react";
import { formatDateTime, formatNumber } from "@/shared/lib/format.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import {
  availablePoints,
  permanentPoints,
  periodExpiresAt,
  periodPoints,
} from "../lib/balance.js";

export function BalanceStrip({ balance }) {
  const { t } = useI18n();
  if (!balance) return null;
  const total = availablePoints(balance);
  const permanent = permanentPoints(balance);
  const period = periodPoints(balance);
  const expires = periodExpiresAt(balance);
  const hasPeriod = period > 0;

  return (
    <section className="card balance-strip" aria-label={t("billing.current_points")}>
      <div className="balance-strip-body">
        <div className="balance-strip-main">
          <span className="balance-strip-label">{t("billing.available_points")}</span>
          <strong className="balance-strip-total">
            {formatNumber(total)}
            <small>{t("billing.points_unit")}</small>
          </strong>
        </div>

        <div className="balance-strip-buckets" role="list">
          <div className="balance-strip-bucket" role="listitem">
            <span className="balance-strip-bucket-label">{t("billing.permanent")}</span>
            <strong className="balance-strip-bucket-value">
              {formatNumber(permanent)}
            </strong>
            <span className="balance-strip-bucket-meta muted">{t("billing.no_expiry")}</span>
          </div>
          <div
            className={`balance-strip-bucket${hasPeriod ? " has-period" : ""}`}
            role="listitem"
          >
            <span className="balance-strip-bucket-label">{t("billing.temporary")}</span>
            <strong className="balance-strip-bucket-value">
              {formatNumber(period)}
            </strong>
            {hasPeriod && expires ? (
              <span className="balance-strip-bucket-meta balance-strip-expire">
                {t("billing.until")} {formatDateTime(expires)}
              </span>
            ) : (
              <span className="balance-strip-bucket-meta muted">{t("billing.none")}</span>
            )}
          </div>
        </div>
      </div>

      <p className="balance-strip-hint muted">
        {hasPeriod ? t("billing.hint_with_period") : t("billing.hint_no_period")}
      </p>
    </section>
  );
}
