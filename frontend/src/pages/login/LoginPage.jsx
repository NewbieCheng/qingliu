import React, { useState } from "react";
import { LoginForm, RegisterForm } from "@/features/auth/index.js";

// 登录页采用紧凑单卡片布局：Logo → 个人/企业登录 → 表单 → 底部入口。
// 与工作台登录页保持一致的视觉节奏，用户在两套系统之间切换不会迷失。
export function LoginPage() {
  const [tab, setTab] = useState("login");

  return (
    <main className="auth-page">
      <section className="auth-card">
        <header className="auth-brand">
          <img src="/qingliu-logo.svg" alt="青流" className="auth-logo" />
          <div className="auth-brand-text">
            <span className="auth-brand-name">今天不加班 AI</span>
            <span className="auth-brand-tag">AI 赋能工作 · 生活更有分寸</span>
          </div>
        </header>

        {tab === "register" ? (
          <RegisterForm onDone={() => setTab("login")} />
        ) : (
          <LoginForm onRegister={() => setTab("register")} />
        )}
      </section>
      <p className="auth-foot">
        青流工作台 · 账号由「今天不加班」统一管理
      </p>
    </main>
  );
}
