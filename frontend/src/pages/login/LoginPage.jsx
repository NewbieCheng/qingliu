import React, { useState } from "react";
import { LoginForm, RegisterForm } from "@/features/auth/index.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import { LanguageSwitch } from "@/shared/ui/LanguageSwitch.jsx";

/**
 * 登录页：一张可复核的工作底稿。
 *
 * 版式来自这个产品自己的语言 —— 账本纸、装订边、深松绿墨色、铜色标线，
 * 与工作台内的底稿保持一致。左侧是底稿页眉（品牌 + 一句话的产品主张），
 * 右侧是登录本身；两栏共用同一条装订边，不是两张浮起来的卡片。
 *
 * 人机验证不常驻在表单里：用户点「登录」才出题，验证通过后再提交登录。
 */
export function LoginPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("login");
  const registering = tab === "register";

  return (
    <main className="auth-page auth-login">
      <div className="auth-sheet">
        <div className="auth-cover">
          <span className="auth-cover-rule" aria-hidden="true" />
          <span className="auth-cover-grid" aria-hidden="true" />

          <div className="auth-cover-inner">
            <header className="auth-brand">
              <img
                src="/qingliu-icon.svg"
                alt=""
                aria-hidden="true"
                className="auth-brand-mark"
              />
              <span className="auth-brand-name">{t("app.name")}</span>
              <span className="auth-brand-tag">{t("auth.cover_tag")}</span>
            </header>

            <div className="auth-cover-copy">
              <h1 className="auth-cover-headline">{t("auth.cover_headline")}</h1>
              <p className="auth-cover-sub">{t("auth.cover_desc")}</p>
            </div>

            <footer className="auth-cover-foot">
              <span className="auth-cover-badge">{t("auth.cover_badge")}</span>
              <span className="auth-cover-note">{t("auth.cover_internal")}</span>
            </footer>
          </div>
        </div>

        <section className="auth-panel">
          <div className="auth-panel-inner">
            <header className="auth-panel-head">
              <div className="auth-panel-head-row">
                <h2 className="auth-panel-title">
                  {registering ? t("auth.register_title") : t("auth.login_title")}
                </h2>
                <LanguageSwitch className="language-switch--login" />
              </div>
              <p className="auth-panel-sub">
                {registering
                  ? t("auth.register_subtitle")
                  : t("auth.login_subtitle")}
              </p>
            </header>

            {registering ? (
              <RegisterForm onDone={() => setTab("login")} />
            ) : (
              <LoginForm onRegister={() => setTab("register")} />
            )}

            <p className="auth-panel-foot">
              {t("auth.footer")}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
