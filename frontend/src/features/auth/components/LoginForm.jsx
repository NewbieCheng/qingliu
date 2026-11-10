import React, { useCallback, useEffect, useRef, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { api } from "@/shared/api/client.js";
import { toast } from "@/shared/ui/toast-api.js";
import { useAuth } from "../context.js";
import { navigate } from "@/shared/router/index.js";
import { LoginPassword } from "./LoginPassword.jsx";
import { CaptchaChallenge } from "./CaptchaChallenge.jsx";
import { ForgotPasswordPanel } from "./ForgotPasswordPanel.jsx";

// 仅本地开发（vite dev）用：从 frontend/.env.local 读预填账号，构建产物里为空。
const DEV_PRESETS = import.meta.env.DEV
  ? [
      {
        id: "admin",
        label: "管理员",
        email:
          import.meta.env.VITE_DEV_LOGIN_ADMIN_EMAIL ||
          import.meta.env.VITE_DEV_LOGIN_USERNAME ||
          "",
        password:
          import.meta.env.VITE_DEV_LOGIN_ADMIN_PASSWORD ||
          import.meta.env.VITE_DEV_LOGIN_PASSWORD ||
          "",
      },
      {
        id: "sales",
        label: "业务员",
        email: import.meta.env.VITE_DEV_LOGIN_SALES_EMAIL || "",
        password: import.meta.env.VITE_DEV_LOGIN_SALES_PASSWORD || "",
      },
    ].filter((item) => item.email && item.password)
  : [];

const defaultDev = DEV_PRESETS[0] || {
  email: import.meta.env.DEV ? import.meta.env.VITE_DEV_LOGIN_USERNAME || "" : "",
  password: import.meta.env.DEV ? import.meta.env.VITE_DEV_LOGIN_PASSWORD || "" : "",
};

const CODE_COOLDOWN_SECONDS = 60;

// 用户取消人机验证时用它中断提交流程：它不是错误，不该弹错误 toast。
const CANCELLED = Object.assign(new Error("已取消人机验证"), { silent: true });

export function LoginForm({ onRegister }) {
  const { login, rememberedUsername, rememberUsername } = useAuth();
  // password = 账号密码（默认）；email = 邮箱验证码。
  const [mode, setMode] = useState("password");
  // 本地 DEV：优先用 .env.local 预填；有记忆用户名时仍尊重记忆（仅填邮箱，密码仍用预填默认）。
  const [email, setEmail] = useState(rememberedUsername || defaultDev.email || "");
  const [password, setPassword] = useState(defaultDev.password || "");
  const [devPreset, setDevPreset] = useState(DEV_PRESETS[0]?.id || "");
  const [agreed, setAgreed] = useState(true);
  const [submitError, setSubmitError] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // 人机验证：密码登录点「登录」才弹；邮箱登录点「发送验证码」才弹。
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeKind, setChallengeKind] = useState("login"); // login | send-code
  const [captcha, setCaptcha] = useState({ id: "", code: "" });
  const waiter = useRef(null);
  const cooldownTimer = useRef(null);

  useEffect(
    () => () => {
      if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
    },
    [],
  );

  const askCaptcha = useCallback(
    (kind) =>
      new Promise((resolve) => {
        waiter.current = resolve;
        setChallengeKind(kind);
        setChallengeOpen(true);
      }),
    [],
  );

  const closeChallenge = useCallback((answer) => {
    setChallengeOpen(false);
    const resolve = waiter.current;
    waiter.current = null;
    resolve?.(answer);
  }, []);

  function startCooldown() {
    setCooldown(CODE_COOLDOWN_SECONDS);
    if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
    cooldownTimer.current = window.setInterval(() => {
      setCooldown((value) => {
        if (value <= 1) {
          window.clearInterval(cooldownTimer.current);
          cooldownTimer.current = null;
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  }

  function requestCode() {
    const target = email.trim();
    if (!target) {
      toast("请先填写邮箱", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      toast("邮箱格式不正确", "error");
      return;
    }
    if (cooldown > 0 || sending) return;
    setChallengeOpen(true);
    setChallengeKind("send-code");
  }

  async function sendCode(captchaId, captchaCode) {
    setSending(true);
    try {
      await api("/api/auth/verification-codes", {
        target: email.trim(),
        purpose: "login",
        captcha_id: captchaId,
        captcha_code: captchaCode,
      });
      setCodeSent(true);
      startCooldown();
      toast("验证码已发送请查收邮箱");
    } catch (error) {
      toast(error.message || "验证码发送失败", "error");
    } finally {
      setSending(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setSubmitError("");
    setCaptcha({ id: "", code: "" });
  }

  function applyDevPreset(preset) {
    setDevPreset(preset.id);
    setEmail(preset.email);
    setPassword(preset.password);
    setMode("password");
    setSubmitError("");
    setCaptcha({ id: "", code: "" });
  }

  return (
    <>
      {DEV_PRESETS.length > 0 && (
        <div className="auth-dev-presets" role="group" aria-label="本地测试账号">
          <span className="auth-dev-presets__hint">本地预填</span>
          {DEV_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={devPreset === preset.id ? "is-active" : ""}
              onClick={() => applyDevPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <div className="auth-tabs" role="tablist" aria-label="登录方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          className={`auth-tab ${mode === "password" ? "is-active" : ""}`}
          onClick={() => switchMode("password")}
        >
          账号密码
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "email"}
          className={`auth-tab ${mode === "email" ? "is-active" : ""}`}
          onClick={() => switchMode("email")}
        >
          邮箱登录
        </button>
      </div>

      <Form
        className="auth-form"
        success="登录成功"
        onSave={async (form) => {
          if (!agreed) throw new Error("请先阅读并同意用户协议与隐私政策");
          const account = String(
            mode === "email" ? email : form.get("username") || email,
          ).trim();

          try {
            if (mode === "email") {
              if (!codeSent) throw new Error("请先获取邮箱验证码");
              const code = String(form.get("code")).trim();
              if (!code) throw new Error("请填写邮箱验证码");
              await login({ email: account, code });
            } else {
              let answer = captcha;
              if (!answer.code) {
                const solved = await askCaptcha("login");
                if (!solved || solved === CANCELLED) throw CANCELLED;
                answer = solved;
                setCaptcha(solved);
              }
              await login({
                username: account,
                password: form.get("password"),
                captcha_id: answer.id,
                captcha_code: String(answer.code).trim(),
              });
            }
          } catch (error) {
            if (mode === "password") setCaptcha({ id: "", code: "" });
            setSubmitError(error?.message || "登录失败，请重试");
            error.silent = true;
            throw error;
          }
          setSubmitError("");
          rememberUsername(account, true);
          navigate("/");
        }}
      >
        {mode === "password" ? (
          <>
            <label className="auth-field">
              <span className="auth-label">工作邮箱 / 手机号</span>
              <input
                name="username"
                autoComplete="username"
                required
                maxLength="120"
                placeholder="请输入工作台账号"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="auth-field">
              <span className="auth-label">密码</span>
              <LoginPassword
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="auth-field">
              <span className="auth-label">邮箱</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength="120"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="auth-field">
              <span className="auth-label">邮箱验证码</span>
              <div className="auth-code-row">
                <input
                  name="code"
                  required
                  maxLength="8"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6 位验证码"
                />
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={sending || cooldown > 0}
                >
                  {sending
                    ? "发送中…"
                    : cooldown > 0
                      ? `${cooldown}s 后重发`
                      : codeSent
                        ? "重新发送"
                        : "发送验证码"}
                </button>
              </div>
            </label>
          </>
        )}

        <label className="auth-agree">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>我已阅读并同意《用户协议》与《隐私政策》</span>
        </label>

        {submitError ? (
          <p className="auth-error" role="alert">
            {submitError}
          </p>
        ) : null}

        <button className="auth-submit" disabled={!agreed}>
          登录工作台
        </button>
      </Form>

      <div className="auth-links">
        <span>
          还没有账号？
          <button type="button" className="auth-link" onClick={onRegister}>
            注册
          </button>
        </span>
        <button
          type="button"
          className="auth-link"
          onClick={() => setForgotOpen(true)}
        >
          忘记密码
        </button>
      </div>

      <ForgotPasswordPanel
        open={forgotOpen}
        initialEmail={email}
        onClose={() => setForgotOpen(false)}
      />

      <CaptchaChallenge
        open={challengeOpen}
        title={challengeKind === "send-code" ? "发送验证码前确认" : "登录前确认"}
        reason={
          challengeKind === "send-code"
            ? "发送邮箱验证码前需要确认这一步由真人完成。"
            : "这次登录需要确认由真人操作。点完提示中的图标后，会继续登录。"
        }
        onCancel={() => {
          if (challengeKind === "send-code") {
            setChallengeOpen(false);
            return;
          }
          closeChallenge(CANCELLED);
        }}
        onSolved={(code, id) => {
          if (!code || !id) return;
          if (challengeKind === "send-code") {
            setChallengeOpen(false);
            void sendCode(id, code);
            return;
          }
          closeChallenge({ id, code });
        }}
      />
    </>
  );
}
