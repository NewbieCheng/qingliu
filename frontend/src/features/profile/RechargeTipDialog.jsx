import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
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
  const { locale, t } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
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
        setError(requestError.message || copy("余额读取失败", "Could not load balance"));
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
    <Modal title={copy("充值积分", "Top up points")} onClose={onClose}>
      <p className="account-dialog-lead">
        {copy("AI 解析按实际用量扣减积分；余额与流水以工作台为准。充值后积分会同步到当前账号。", "AI analysis deducts points based on actual usage. The Workbench is the source of truth for balances and ledger entries. Top-ups sync to the current account.")}
      </p>

      <div className="account-balance-card">
        <span className="account-balance-label">{copy("当前可用额度", "Available balance")}</span>
        {loading ? (
          <strong className="account-balance-value is-muted">{t("common.loading")}</strong>
        ) : error ? (
          <strong className="account-balance-value is-muted">{error}</strong>
        ) : (
          <>
            <strong className="account-balance-value">
              {Number(points ?? 0).toLocaleString(locale === "en-US" ? "en-US" : "zh-CN")}
              <small>{copy("积分", "points")}</small>
            </strong>
            {/* 可用额度由两个桶组成：永久不过期，临时有到期日 —— 必须分开写，
                否则「明明还有额度却提示不足 / 月底突然清零」没法解释。 */}
            <p className="account-balance-split">
              {copy("永久", "Permanent")} {Number(permanent).toLocaleString(locale === "en-US" ? "en-US" : "zh-CN")} · {copy("临时", "Temporary")}{" "}
              {Number(period).toLocaleString(locale === "en-US" ? "en-US" : "zh-CN")}
              {period > 0 && expires
                ? `{locale === "en-US" ? "(" : "（"}{expires.toLocaleString(locale === "en-US" ? "en-US" : "zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })} {copy("到期作废", "expires; unused points are forfeited")}{locale === "en-US" ? ")" : "）"}`
                : ""}
            </p>
            <p className="account-balance-split is-muted">
              {copy(" 扣费先扣临时积分，再扣永久积分。", " Charges deduct temporary points first, then permanent points.")}
            </p>
          </>
        )}
      </div>

      <div className="account-dialog-actions">
        <button type="button" className="ghost" onClick={onClose}>
          {copy("稍后再说", "Maybe later")}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            onClose?.();
            navigate("/recharge");
          }}
        >
          {copy("前往充值", "Top up now")}
        </button>
      </div>
    </Modal>
  );
}
