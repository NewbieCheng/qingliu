import React from "react";
import { LoginForm } from "@/features/auth/index.js";
import { ShieldIcon } from "@/shared/ui/icons.jsx";

export function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-visual" aria-hidden="true">
        <div className="login-visual-grid" />
        <div className="login-visual-ring" />
        <div className="login-visual-top">
          <img
            src="/qingliu-logo-dark.svg"
            alt="青流"
            className="login-visual-logo"
          />
        </div>
        <div className="login-visual-copy">
          <h1>
            资料有据，
            <br />
            测算有序。
          </h1>
          <p>
            原件留存、人工复核、版本留痕。
            <br />
            从资料到测算，每一笔都有依据。
          </p>
        </div>
        <div className="login-visual-foot">
          <span>今天不加班旗下 · 企业 AI 工作台</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-panel-inner">
          <div className="login-mobile-brand">
            <img src="/qingliu-logo.svg" alt="青流" />
          </div>
          <div className="login-panel-head">
            <span className="login-wordmark">青流工作台</span>
            <span className="login-secure">
              <ShieldIcon />
              安全登录
            </span>
          </div>
          <h2>登录</h2>
          <p className="login-panel-desc">
            使用工作台账号进入客户资料与流水核对。
          </p>
          <LoginForm />
          <p className="login-panel-note">
            账号由「今天不加班」工作台统一管理。登录即表示同意内部资料保密与留痕要求。
          </p>
        </div>
      </section>
    </main>
  );
}
