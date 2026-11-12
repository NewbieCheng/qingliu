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
  const { locale } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
  if (!balance) return null;
  const total = availablePoints(balance);
  const permanent = permanentPoints(balance);
  const period = periodPoints(balance);
  const expires = periodExpiresAt(balance);
  const hasPeriod = period > 0;

  return (
    <section className="card balance-strip" aria-label={copy("当前积分", "Current points")}>
      <div className="balance-strip-body">
        <div className="balance-strip-main">
          <span className="balance-strip-label">Available points</span>
          <strong className="balance-strip-total">
            {formatNumber(total)}
            <small>{copy("积分", "points")}</small>
          </strong>
        </div>

        <div className="balance-strip-buckets" role="list">
          <div className="balance-strip-bucket" role="listitem">
            <span className="balance-strip-bucket-label">{copy("永久", "Permanent")}</span>
            <strong className="balance-strip-bucket-value">
              {formatNumber(permanent)}
            </strong>
            <span className="balance-strip-bucket-meta muted">{copy("不过期", "No expiry")}</span>
          </div>
          <div
            className={`balance-strip-bucket${hasPeriod ? " has-period" : ""}`}
            role="listitem"
          >
            <span className="balance-strip-bucket-label">{copy("临时", "Temporary")}</span>
            <strong className="balance-strip-bucket-value">
              {formatNumber(period)}
            </strong>
            {hasPeriod && expires ? (
              <span className="balance-strip-bucket-meta balance-strip-expire">
                {copy("至", "Until")} {formatDateTime(expires)}
              </span>
            ) : (
              <span className="balance-strip-bucket-meta muted">{copy("暂无", "None")}</span>
            )}
          </div>
        </div>
      </div>

      <p className="balance-strip-hint muted">
        {hasPeriod
          ? "Unused temporary points expire. Charges use temporary first, then permanent."
          : "Permanent points do not expire. After a subscription, temporary quota and expiry appear."}
      </p>
    </section>
  );
}
