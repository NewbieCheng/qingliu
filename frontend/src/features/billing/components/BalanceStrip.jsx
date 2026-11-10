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

  return (
    <section className="card balance-strip" aria-label="当前积分">
      <div className="balance-strip-main">
        <span className="balance-strip-label">可用积分</span>
        <strong className="balance-strip-total">
          {formatNumber(total)}
          <small>积分</small>
        </strong>
      </div>
      <div className="balance-strip-split">
        <span>
          永久 <strong>{formatNumber(permanent)}</strong>
        </span>
        <span>
          本期 <strong>{formatNumber(period)}</strong>
          {period > 0 && expires ? (
            <small className="muted"> · 至 {formatDateTime(expires)}</small>
          ) : null}
        </span>
      </div>
      {period > 0 ? (
        <p className="balance-strip-hint muted">
          本期额度到期未用完将作废；扣费先扣本期，再扣永久。
        </p>
      ) : (
        <p className="balance-strip-hint muted">
          永久积分不过期。订阅套餐到账后会出现本期额度与到期时间。
        </p>
      )}
    </section>
  );
}
