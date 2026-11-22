import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { LanguageSwitch } from "@/shared/ui/LanguageSwitch.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { ROLES } from "@/shared/lib/constants.js";
import {
  invalidateBalance,
  invalidateProfile,
  queryBalance,
  queryProfile,
} from "@/app/queries/index.js";
import { availablePoints } from "@/shared/lib/billing.js";
import { ChangePasswordDialog } from "@/app/ChangePasswordDialog.jsx";
import {
  LogoutConfirmDialog,
  RechargeTipDialog,
} from "@/features/profile/index.js";
import { ChromeAccessory } from "@/shared/layout/ChromeTitle.jsx";

const TAB_ACCOUNT = "account";
const TAB_PREFS = "prefs";

export function ProfilePage() {
  const { t } = useI18n();
  const roleLabel = (role) => {
    if (!role) return "";
    const key = `role.${role}`;
    const translated = t(key);
    return translated === key ? ROLES[role] || role : translated;
  };
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(""); // password | recharge | logout
  const [tab, setTab] = useState(TAB_ACCOUNT);
  const [points, setPoints] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    setError("");
    try {
      if (force) {
        invalidateProfile();
      }
      const profile = await queryProfile({ force });
      setMe(profile.user);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function loadBalance(force = false) {
    if (force) invalidateBalance();
    const data = await queryBalance({ force });
    setPoints(availablePoints(data));
    return data;
  }

  useEffect(() => {
    void load();
    void loadBalance().catch(() => setPoints(null));
    const onChanged = () => {
      void loadBalance(true).catch(() => setPoints(null));
    };
    window.addEventListener("ql:balance-changed", onChanged);
    return () => window.removeEventListener("ql:balance-changed", onChanged);
  }, []);

  const tabs = (
    <ChromeAccessory>
      <div className="account-tabs account-tabs--chrome" role="tablist" aria-label={t("profile.tabs_aria")}>
        <button
          type="button"
          role="tab"
          className={`account-tab ${tab === TAB_ACCOUNT ? "active" : ""}`}
          aria-selected={tab === TAB_ACCOUNT}
          onClick={() => setTab(TAB_ACCOUNT)}
        >
          {t("profile.tab_account")}
        </button>
        <button
          type="button"
          role="tab"
          className={`account-tab ${tab === TAB_PREFS ? "active" : ""}`}
          aria-selected={tab === TAB_PREFS}
          onClick={() => setTab(TAB_PREFS)}
        >
          {t("profile.tab_prefs")}
        </button>
      </div>
    </ChromeAccessory>
  );

  if (!me) {
    return (
      <main className="account-page">
        {tabs}
        <Loading text={t("profile.loading")} error={error} onRetry={load} />
      </main>
    );
  }

  // 当前空间按工作台契约读：kind（personal|team|platform）+ name + role_label。
  const kind = me.kind || me.space?.kind || "personal";
  const scopeText =
    kind === "team"
      ? me.space_name || t("space.team_short")
      : kind === "platform"
        ? t("profile.scope_platform")
        : t("profile.scope_personal");

  async function refreshBalance() {
    setRefreshing(true);
    try {
      await loadBalance(true);
      // 通知顶栏等同监听方重拉；本页已写入 points，监听里再拉一次无害。
      window.dispatchEvent(new Event("ql:balance-changed"));
      toast(t("profile.prefs_refresh_done"));
    } catch (requestError) {
      setPoints(null);
      toast(requestError.message || t("profile.balance_load_failed"), "error");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="account-page">
      {tabs}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {tab === TAB_ACCOUNT ? (
        <>
          <section
            className="account-identity"
            aria-label={t("profile.identity_aria")}
          >
            <div className="account-identity-lead">
              <p className="account-identity-name">{me.display || "—"}</p>
              <div className="account-identity-badges">
                {roleLabel(me.service_role || me.role) || me.role ? (
                  <span className="account-identity-badge">
                    {roleLabel(me.service_role || me.role) || me.role}
                  </span>
                ) : null}
                {kind === "team" && me.role_label ? (
                  <span className="account-identity-badge is-space">
                    {me.role_label}
                  </span>
                ) : null}
              </div>
            </div>
            <dl className="account-identity-meta">
              <div className="account-identity-item">
                <dt>{t("profile.login_account")}</dt>
                <dd>{me.email || me.username}</dd>
              </div>
              <div className="account-identity-item">
                <dt>
                  {kind === "team"
                    ? t("profile.team_name")
                    : t("profile.data_scope")}
                </dt>
                <dd>{scopeText}</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <SectionTitle
              title={t("profile.actions_title")}
              description={t("profile.actions_desc")}
            />
            <div className="account-action-grid">
              <button
                type="button"
                className="account-action"
                onClick={() => setDialog("password")}
              >
                <strong>{t("profile.change_password")}</strong>
                <span>{t("profile.change_password_hint")}</span>
              </button>
              <button
                type="button"
                className="account-action"
                onClick={() => setDialog("recharge")}
              >
                <strong>{t("profile.top_up")}</strong>
                <span>{t("profile.top_up_hint")}</span>
              </button>
              <button
                type="button"
                className="account-action is-danger"
                onClick={() => setDialog("logout")}
              >
                <strong>{t("auth.sign_out")}</strong>
                <span>{t("profile.sign_out_hint")}</span>
              </button>
            </div>
          </section>
        </>
      ) : (
        <section className="card" aria-label={t("profile.tab_prefs")}>
          <SectionTitle
            title={t("profile.prefs_title")}
            description={t("profile.prefs_desc")}
          />
          <div className="account-prefs-list">
            <div className="account-prefs-row">
              <div className="account-prefs-copy">
                <strong>{t("topbar.lang")}</strong>
                <span>{t("profile.prefs_lang_hint")}</span>
              </div>
              <LanguageSwitch className="account-prefs-control" />
            </div>
            <div className="account-prefs-row">
              <div className="account-prefs-copy">
                <strong>{t("profile.prefs_balance")}</strong>
                <span>
                  {points === null
                    ? t("profile.balance_load_failed")
                    : t("profile.prefs_balance_value", {
                        n: Number(points).toLocaleString(),
                      })}
                </span>
              </div>
              <button
                type="button"
                className="account-prefs-control"
                disabled={refreshing}
                onClick={() => void refreshBalance()}
              >
                {refreshing ? t("topbar.refreshing") : t("topbar.refresh")}
              </button>
            </div>
          </div>
        </section>
      )}

      {dialog === "password" ? (
        <ChangePasswordDialog onClose={() => setDialog("")} />
      ) : null}
      {dialog === "recharge" ? (
        <RechargeTipDialog onClose={() => setDialog("")} />
      ) : null}
      {dialog === "logout" ? (
        <LogoutConfirmDialog onClose={() => setDialog("")} />
      ) : null}
    </main>
  );
}
