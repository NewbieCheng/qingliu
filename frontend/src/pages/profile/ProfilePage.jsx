import React, { useEffect, useState } from "react";
import { Loading } from "@/shared/ui/Loading.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { FormRow } from "@/shared/ui/FormRow.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { ROLES } from "@/shared/lib/constants.js";
import { Link, navigate } from "@/shared/router/index.js";
import { invalidateProfile, queryProfile } from "@/app/queries/index.js";
import { changePassword, logout, SpaceCard } from "@/features/profile/index.js";

export function ProfilePage() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function onChangePassword(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await changePassword({
        current_password: form.get("current_password"),
        new_password: form.get("new_password"),
      });
      event.currentTarget.reset();
      toast("密码已更新，请使用新密码重新登录");
      await logout();
      navigate("/login");
    } catch (requestError) {
      toast(requestError.message, "error");
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return (
      <main className="account-page">
        <Loading text="正在读取个人信息…" error={error} onRetry={load} />
      </main>
    );
  }

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
      <section className="card">
        <FormRow label="登录账号">
          <strong>{me.email || me.username}</strong>
        </FormRow>
        <FormRow label="显示名">
          <strong>{me.display || "—"}</strong>
        </FormRow>
        <FormRow label="服务角色">
          <strong>{ROLES[me.service_role] || ROLES[me.role] || me.role}</strong>
        </FormRow>
        <FormRow label={me.scope === "team" ? "所属团队" : "资料范围"}>
          <strong>{me.scope === "team" ? me.tenant_name || "团队" : "个人空间（仅自己可见）"}</strong>
        </FormRow>
        {me.scope === "team" && (
          <FormRow label="团队角色">
            <strong>
              {me.tenant_role === "admin" ? "团队管理员（可看本团队全部资料）" : "团队成员（可看本团队全部资料）"}
            </strong>
          </FormRow>
        )}
      </section>
      {/* 一个人可以同时属于企业空间与自己的个人空间；切换入口只在会员关系
          多于一个时才有意义，因此由 SpaceCard 自己决定是否显示提示。 */}
      <SpaceCard />
      <section className="card">
        <SectionTitle
          title="修改密码"
          description="已绑定工作台时，密码修改会同步到工作台账号。"
        />
        <form className="profile-form" onSubmit={onChangePassword}>
          <label className="field">
            <span>当前密码</span>
            <input
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            <span>新密码（10 至 72 字节）</span>
            <input
              name="new_password"
              type="password"
              minLength="10"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "正在保存…" : "更新密码"}
          </button>
        </form>
      </section>
      <section className="card actions-row">
        <Link className="button-link" to="/recharge">
          去充值
        </Link>
        <button
          className="ghost"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          退出登录
        </button>
      </section>
    </main>
  );
}
