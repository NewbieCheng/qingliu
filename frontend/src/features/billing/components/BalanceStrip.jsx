import React from "react";
import { formatDateTime, formatNumber } from "@/shared/lib/format.js";
import {
  availablePoints,
  permanentPoints,
  periodExpiresAt,
  periodPoints,
} from "../lib/balance.js";

export function BalanceStrip({ balance }) {
  if (!balance) return null;
  const total = availablePoints(balance);
  const permanent = permanentPoints(balance);
  const period = periodPoints(balance);
  const expires = periodExpiresAt(balance);
  const hasPeriod = period > 0;

  return (
    <section className="card balance-strip" aria-label="当前积分">
      <div className="balance-strip-body">
        <div className="balance-strip-main">
          <span className="balance-strip-label">Available points</span>
          <strong className="balance-strip-total">
            {formatNumber(total)}
            <small>积分</small>
          </strong>
        </div>

        <div className="balance-strip-buckets" role="list">
          <div className="balance-strip-bucket" role="listitem">
            <span className="balance-strip-bucket-label">永久</span>
            <strong className="balance-strip-bucket-value">
              {formatNumber(permanent)}
            </strong>
            <span className="balance-strip-bucket-meta muted">不过期</span>
          </div>
          <div
            className={`balance-strip-bucket${hasPeriod ? " has-period" : ""}`}
            role="listitem"
          >
            <span className="balance-strip-bucket-label">临时</span>
            <strong className="balance-strip-bucket-value">
              {formatNumber(period)}
            </strong>
            {hasPeriod && expires ? (
              <span className="balance-strip-bucket-meta balance-strip-expire">
                至 {formatDateTime(expires)}
              </span>
            ) : (
              <span className="balance-strip-bucket-meta muted">暂无</span>
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
