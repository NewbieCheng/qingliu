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
  const { locale, t } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
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
        <Loading text={copy("正在读取个人信息…", "Loading profile…")} error={error} onRetry={load} />
      </main>
    );
  }

  // 当前空间按工作台契约读：kind（personal|team|platform）+ name + role_label。
  const kind = me.kind || me.space?.kind || "personal";
  const scopeText =
    kind === "team"
      ? me.space_name || copy("团队", "Team")
      : kind === "platform"
        ? copy("平台空间目前未在青流接入；这里只显示您创建的资料。", "Platform space is not available in Qingliu yet; only files you created are shown.")
        : copy("个人空间（仅自己可见）", "Personal space (only visible to you)");

  return (
    <main className="account-page">
      <PageHeader
        title={me.display}
        description={copy("账号由工作台统一管理；青流保存业务角色与本地工作记录。", "Accounts are managed by the Workbench; Qingliu keeps business roles and local work records.")}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="card account-identity" aria-label={copy("账号信息", "Account information")}>
        <dl className="account-identity-grid">
          <div className="account-identity-item">
            <dt>{copy("登录账号", "Login account")}</dt>
            <dd>{me.email || me.username}</dd>
          </div>
          <div className="account-identity-item">
            <dt>{copy("显示名", "Display name")}</dt>
            <dd>{me.display || "—"}</dd>
          </div>
          <div className="account-identity-item">
            <dt>{copy("服务角色", "Service role")}</dt>
            <dd>{roleLabel(me.service_role || me.role) || me.role}</dd>
          </div>
          <div className="account-identity-item">
            <dt>{kind === "team" ? copy("所属团队", "Team") : copy("资料范围", "Data scope")}</dt>
            <dd>{scopeText}</dd>
          </div>
          {kind === "team" && me.role_label ? (
            <div className="account-identity-item">
              <dt>{copy("空间角色", "Space role")}</dt>
              <dd>{me.role_label}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="card">
        <SectionTitle
          title={copy("账号操作", "Account actions")}
          description={copy("修改密码、充值和退出登录都需要二次确认。", "Password changes, top-ups, and sign-outs use confirmation dialogs.")}
        />
        <div className="account-action-grid">
          <button
            type="button"
            className="account-action"
            onClick={() => setDialog("password")}
          >
            <strong>{copy("修改密码", "Change password")}</strong>
            <span>{copy("验证当前密码后设置新密码，成功后需重新登录", "Verify your current password to set a new one. You will need to sign in again after success.")}</span>
          </button>
          <button
            type="button"
            className="account-action"
            onClick={() => setDialog("recharge")}
          >
            <strong>{copy("去充值", "Top up")}</strong>
            <span>{copy("查看当前积分额度，前往购买工作台积分", "View your available points and buy Workbench points")}</span>
          </button>
          <button
            type="button"
            className="account-action is-danger"
            onClick={() => setDialog("logout")}
          >
            <strong>{copy("退出登录", "Sign out")}</strong>
            <span>{copy("结束当前设备会话，不影响其他已登录设备", "End this device's session without affecting other signed-in devices.")}</span>
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
