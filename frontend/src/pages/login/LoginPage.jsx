import React, { useState } from "react";
import { LoginForm, RegisterForm } from "@/features/auth/index.js";

/**
 * 登录页：与「今天不加班工作台」同一套版式 —— 左侧品牌区（黑色底 + 橙色辉光），
 * 右侧登录卡。两套系统同属一家公司，视觉上必须是同一个入口的感觉，
 * 用户从工作台跳到清流不该觉得换了产品。
 *
 * 左侧用清流自己的 Logo（白色版），因为这里是清流的入口；
 * 母品牌「今天不加班」作为副标题出现。
 */
export function LoginPage() {
  const [tab, setTab] = useState("login");

  return (
    <main className="auth-page auth-page--split">
      <div className="auth-split">
        <aside className="auth-aside">
          <div className="auth-aside-glow" aria-hidden="true" />
          <div className="auth-aside-inner">
            <header className="auth-aside-head">
              {/* 用「浅色图标 + 文字」而不是整张 logo 反白：
                  logo 文件自带一块深绿底板，反白后会变成一个白方块。 */}
              <img
                src="/qingliu-icon-light.svg"
                alt=""
                aria-hidden="true"
                className="auth-aside-mark"
              />
              <span className="auth-aside-name">青流</span>
            </header>

            <div className="auth-aside-copy">
              <h1 className="auth-aside-headline">
                把流水看清
                <br />
                把时间还给业务
              </h1>
              <p className="auth-aside-sub">
                银行流水自动解析、风险自动识别、报告一键生成。
                <br />
                青流工作台 · 账号与「今天不加班」统一管理。
              </p>
            </div>

            <footer className="auth-aside-foot">
              <span className="auth-aside-badge">今天不加班 · 旗下产品</span>
            </footer>
          </div>
        </aside>

        <section className="auth-panel">
          <div className="auth-panel-inner">
            <header className="auth-panel-head">
              <h2 className="auth-panel-title">
                {tab === "register" ? "创建账号" : "登录青流"}
              </h2>
              <p className="auth-panel-sub">
                {tab === "register"
                  ? "使用工作邮箱注册，账号同样适用于今天不加班工作台"
                  : "使用今天不加班工作台账号直接登录"}
              </p>
            </header>

            {tab === "register" ? (
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
