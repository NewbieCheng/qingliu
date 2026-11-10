import React, { useEffect, useState } from "react";
import { Modal } from "@/shared/ui/Modal.jsx";
import { navigate } from "@/shared/router/index.js";
import { queryBalance } from "@/app/queries/index.js";
import { availablePoints } from "@/features/billing/lib/balance.js";

export function RechargeTipDialog({ onClose }) {
  const [points, setPoints] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await queryBalance();
        if (!alive) return;
        setPoints(availablePoints(data) ?? 0);
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
          <strong className="account-balance-value">
            {Number(points).toLocaleString("zh-CN")}
            <small>积分</small>
          </strong>
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
