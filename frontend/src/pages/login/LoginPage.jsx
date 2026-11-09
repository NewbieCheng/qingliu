import React, { useState } from "react";
import { LoginForm, RegisterForm } from "@/features/auth/index.js";

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
              <span className="auth-brand-name">青流</span>
              <span className="auth-brand-tag">流水初筛底稿</span>
            </header>

            <div className="auth-cover-copy">
              <h1 className="auth-cover-headline">
                把每一笔流水，
                <br />
                落成可复核的底稿。
              </h1>
              <p className="auth-cover-sub">
                银行流水自动解析、疑点逐笔标注、报告一键生成。
                账号与「今天不加班」统一管理。
              </p>
            </div>

            <footer className="auth-cover-foot">
              <span className="auth-cover-badge">今天不加班 · 旗下产品</span>
              <span className="auth-cover-note">内部系统 · 请勿外传</span>
            </footer>
          </div>
        </div>

        <section className="auth-panel">
          <div className="auth-panel-inner">
            <header className="auth-panel-head">
              <h2 className="auth-panel-title">
                {registering ? "创建账号" : "登录青流"}
              </h2>
              <p className="auth-panel-sub">
                {registering
                  ? "使用工作邮箱注册，账号同样适用于今天不加班工作台"
                  : "使用今天不加班工作台账号直接登录"}
              </p>
            </header>

            {registering ? (
              <RegisterForm onDone={() => setTab("login")} />
            ) : (
              <LoginForm onRegister={() => setTab("register")} />
            )}

            <p className="auth-panel-foot">
              青流工作台 · 账号由「今天不加班」统一管理
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
