import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { PageHeader, SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { ROLES } from "@/shared/lib/constants.js";
import { invalidateProfile, queryProfile } from "@/app/queries/index.js";
import { ChangePasswordDialog } from "@/app/ChangePasswordDialog.jsx";
import {
  LogoutConfirmDialog,
  RechargeTipDialog,
} from "@/features/profile/index.js";

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

  useEffect(() => {
    void load();
  }, []);

  if (!me) {
    return (
      <main className="account-page">
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

  return (
    <main className="account-page">
      <PageHeader
        title={me.display}
        description={t("profile.page_desc")}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section
        className="card account-identity"
        aria-label={t("profile.identity_aria")}
      >
        <dl className="account-identity-grid">
          <div className="account-identity-item">
            <dt>{t("profile.login_account")}</dt>
            <dd>{me.email || me.username}</dd>
          </div>
          <div className="account-identity-item">
            <dt>{t("profile.display_name")}</dt>
            <dd>{me.display || "—"}</dd>
          </div>
          <div className="account-identity-item">
            <dt>{t("profile.service_role")}</dt>
            <dd>{roleLabel(me.service_role || me.role) || me.role}</dd>
          </div>
          <div className="account-identity-item">
            <dt>
              {kind === "team"
                ? t("profile.team_name")
                : t("profile.data_scope")}
            </dt>
            <dd>{scopeText}</dd>
          </div>
          {kind === "team" && me.role_label ? (
            <div className="account-identity-item">
              <dt>{t("profile.space_role")}</dt>
              <dd>{me.role_label}</dd>
            </div>
          ) : null}
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
