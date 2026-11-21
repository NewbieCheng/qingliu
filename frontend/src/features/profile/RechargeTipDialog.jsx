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
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const numberLocale = locale === "en-US" ? "en-US" : "zh-CN";

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await queryBalance();
        if (!alive) return;
        setBalance(data);
      } catch (requestError) {
        if (!alive) return;
        setError(requestError.message || t("profile.balance_load_failed"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [t]);

  const points = availablePoints(balance);
  const permanent = permanentPoints(balance);
  const period = periodPoints(balance);
  const expires = periodExpiresAt(balance);
  const expiresText =
    period > 0 && expires
      ? expires.toLocaleString(numberLocale, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  return (
    <Modal title={t("profile.recharge_title")} onClose={onClose}>
      <p className="account-dialog-lead">{t("profile.recharge_lead")}</p>

      <div className="account-balance-card">
        <span className="account-balance-label">
          {t("profile.available_balance")}
        </span>
        {loading ? (
          <strong className="account-balance-value is-muted">
            {t("common.loading")}
          </strong>
        ) : error ? (
          <strong className="account-balance-value is-muted">{error}</strong>
        ) : (
          <>
            <strong className="account-balance-value">
              {Number(points ?? 0).toLocaleString(numberLocale)}
              <small>{t("billing.points_unit")}</small>
            </strong>
            {/* 可用额度由两个桶组成：永久不过期，临时有到期日 —— 必须分开写，
                否则「明明还有额度却提示不足 / 月底突然清零」没法解释。 */}
            <p className="account-balance-split">
              {t("billing.permanent")}{" "}
              {Number(permanent).toLocaleString(numberLocale)} ·{" "}
              {t("billing.temporary")}{" "}
              {Number(period).toLocaleString(numberLocale)}
              {expiresText
                ? t("profile.period_expires", { at: expiresText })
                : ""}
            </p>
            <p className="account-balance-split is-muted">
              {t("profile.charge_order_hint")}
            </p>
          </>
        )}
      </div>

      <div className="account-dialog-actions">
        <button type="button" className="btn-outline" onClick={onClose}>
          {t("profile.maybe_later")}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            onClose?.();
            navigate("/recharge");
          }}
        >
          {t("profile.go_recharge")}
        </button>
      </div>
    </Modal>
  );
}
