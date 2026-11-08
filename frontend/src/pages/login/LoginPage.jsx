import React, { useState } from "react";
import { LoginForm, RegisterForm } from "@/features/auth/index.js";
import { ShieldIcon } from "@/shared/ui/icons.jsx";

export function LoginPage() {
  const [tab, setTab] = useState("login");
  const [mode, setMode] = useState(1);

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

          <div className="login-switch" role="tablist" aria-label="登录或注册">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "login"}
              className={`login-switch-btn ${tab === "login" ? "is-active" : ""}`}
              onClick={() => setTab("login")}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "register"}
              className={`login-switch-btn ${tab === "register" ? "is-active" : ""}`}
              onClick={() => setTab("register")}
            >
              注册
            </button>
          </div>

          {tab === "login" ? (
            <>
              <p className="login-panel-desc">
                使用不加班工作台账号进入客户资料与流水核对。
              </p>
              <LoginForm mode={mode} onModeChange={setMode} />
            </>
          ) : (
            <>
              <p className="login-panel-desc">
                使用邀请码注册个人账号，注册后可直接登录青流与不加班工作台。
              </p>
              <RegisterForm />
            </>
          )}

          <p className="login-panel-note">
            账号由「今天不加班」工作台统一管理。
            {tab === "login" ? (
              <>
                {" "}
                还没有账号？
                <button
                  type="button"
                  className="login-inline-link"
                  onClick={() => setTab("register")}
                >
                  立即注册
                </button>
              </>
            ) : (
              <>
                {" "}
                已有账号？
                <button
                  type="button"
                  className="login-inline-link"
                  onClick={() => setTab("login")}
                >
                  返回登录
                </button>
              </>
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
