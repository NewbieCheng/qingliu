import React, { useEffect, useState } from "react";
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
        <Loading text="正在读取个人信息…" error={error} onRetry={load} />
      </main>
    );
  }

  // 当前空间按工作台契约读：kind（personal|team|platform）+ name + role_label。
  const kind = me.kind || me.space?.kind || "personal";
  const scopeText =
    kind === "team"
      ? me.space_name || "团队"
      : kind === "platform"
        ? "平台空间（青流未接入，只显示自己创建的）"
        : "个人空间（仅自己可见）";

  return (
    <main className="account-page">
      <PageHeader
        title={me.display}
        description="账号由工作台统一管理；青流只保留业务角色与本地工作记录。"
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="card account-identity" aria-label="账号信息">
        <dl className="account-identity-grid">
          <div className="account-identity-item">
            <dt>登录账号</dt>
            <dd>{me.email || me.username}</dd>
          </div>
          <div className="account-identity-item">
            <dt>显示名</dt>
            <dd>{me.display || "—"}</dd>
          </div>
          <div className="account-identity-item">
            <dt>服务角色</dt>
            <dd>{ROLES[me.service_role] || ROLES[me.role] || me.role}</dd>
          </div>
          <div className="account-identity-item">
            <dt>{kind === "team" ? "所属团队" : "资料范围"}</dt>
            <dd>{scopeText}</dd>
          </div>
          {kind === "team" && me.role_label ? (
            <div className="account-identity-item">
              <dt>空间角色</dt>
              <dd>{me.role_label}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="card">
        <SectionTitle
          title="账号操作"
          description="改密、充值与退出都通过弹窗确认，避免误触。"
        />
        <div className="account-action-grid">
          <button
            type="button"
            className="account-action"
            onClick={() => setDialog("password")}
          >
            <strong>修改密码</strong>
            <span>验证当前密码后设置新密码，成功后需重新登录</span>
          </button>
          <button
            type="button"
            className="account-action"
            onClick={() => setDialog("recharge")}
          >
            <strong>去充值</strong>
            <span>查看当前积分额度，前往购买工作台积分</span>
          </button>
          <button
            type="button"
            className="account-action is-danger"
            onClick={() => setDialog("logout")}
          >
            <strong>退出登录</strong>
            <span>结束当前设备会话，不影响其他已登录设备</span>
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
