import React, { useEffect, useState } from "react";
import { Modal } from "@/shared/ui/Modal.jsx";
import { navigate } from "@/shared/router/index.js";
import { queryBalance } from "@/app/queries/index.js";
import {
  availablePoints,
  periodExpiresAt,
  periodPoints,
  permanentPoints,
} from "@/features/billing/index.js";

export function RechargeTipDialog({ onClose }) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await queryBalance();
        if (!alive) return;
        setBalance(data);
      } catch (requestError) {
        if (!alive) return;
        setError(requestError.message || "余额读取失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const points = availablePoints(balance);
  const permanent = permanentPoints(balance);
  const period = periodPoints(balance);
  const expires = periodExpiresAt(balance);

  return (
    <Modal title="充值积分" onClose={onClose}>
      <p className="account-dialog-lead">
        AI 解析按实际用量扣减积分；余额与流水以工作台为准。充值后积分会同步到当前账号。
      </p>

      <div className="account-balance-card">
        <span className="account-balance-label">当前可用额度</span>
        {loading ? (
          <strong className="account-balance-value is-muted">读取中…</strong>
        ) : error ? (
          <strong className="account-balance-value is-muted">{error}</strong>
        ) : (
          <>
            <strong className="account-balance-value">
              {Number(points ?? 0).toLocaleString("zh-CN")}
              <small>积分</small>
            </strong>
            {/* 可用额度由两个桶组成：永久不过期，临时有到期日 —— 必须分开写，
                否则「明明还有额度却提示不足 / 月底突然清零」没法解释。 */}
            <p className="account-balance-split">
              永久 {Number(permanent).toLocaleString("zh-CN")} · 临时{" "}
              {Number(period).toLocaleString("zh-CN")}
              {period > 0 && expires
                ? `（${expires.toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })} 到期作废）`
                : ""}
            </p>
            <p className="account-balance-split is-muted">
              扣费先扣临时积分，再扣永久积分。
            </p>
          </>
        )}
      </div>

      <div className="account-dialog-actions">
        <button type="button" className="ghost" onClick={onClose}>
          稍后再说
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            onClose?.();
            navigate("/recharge");
          }}
        >
          前往充值
        </button>
      </div>
    </Modal>
  );
}
