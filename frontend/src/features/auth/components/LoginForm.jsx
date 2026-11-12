import React, { useCallback, useEffect, useRef, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { api } from "@/shared/api/client.js";
import { toast } from "@/shared/ui/toast-api.js";
import { useAuth } from "../context.js";
import { navigate } from "@/shared/router/index.js";
import { LoginPassword } from "./LoginPassword.jsx";
import { CaptchaChallenge } from "./CaptchaChallenge.jsx";
import { ForgotPasswordPanel } from "./ForgotPasswordPanel.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

// 仅本地开发（vite dev）用：从 frontend/.env.local 读预填账号，构建产物里为空。
const DEV_PRESETS = import.meta.env.DEV
  ? [
      {
        id: "admin",
        label: "Admin",
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
        label: "Sales",
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
const CANCELLED = Object.assign(new Error("captcha_cancelled"), { silent: true });

export function LoginForm({ onRegister }) {
  const { t } = useI18n();
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
      toast(t("auth.enter_email_first"), "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      toast(t("auth.invalid_email"), "error");
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
      toast(t("auth.code_sent"));
    } catch (error) {
      toast(error.message || t("auth.send_code_failed"), "error");
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
        <div className="auth-dev-presets" role="group" aria-label={t("auth.dev_preset_group")}>
          <span className="auth-dev-presets__hint">{t("auth.dev_preset")}</span>
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
      <div className="auth-tabs" role="tablist" aria-label={t("auth.login_mode_label")}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "password"}
          className={`auth-tab ${mode === "password" ? "is-active" : ""}`}
          onClick={() => switchMode("password")}
        >
          {t("auth.login_password_tab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "email"}
          className={`auth-tab ${mode === "email" ? "is-active" : ""}`}
          onClick={() => switchMode("email")}
        >
          {t("auth.login_email_tab")}
        </button>
      </div>

      <Form
        className="auth-form"
        success={t("auth.login_success")}
        onSave={async (form) => {
          if (!agreed) throw new Error(t("auth.agree_required"));
          const account = String(
            mode === "email" ? email : form.get("username") || email,
          ).trim();

          try {
            if (mode === "email") {
              if (!codeSent) throw new Error(t("auth.request_code_first"));
              const code = String(form.get("code")).trim();
              if (!code) throw new Error(t("auth.email_code_required"));
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
            setSubmitError(error?.message || t("auth.login_failed"));
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
              <span className="auth-label">{t("auth.email_or_phone")}</span>
              <input
                name="username"
                autoComplete="username"
                required
                maxLength="120"
                placeholder={t("auth.account_placeholder")}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="auth-field">
              <span className="auth-label">{t("auth.password")}</span>
              <LoginPassword
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="auth-field">
              <span className="auth-label">{t("auth.email")}</span>
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
              <span className="auth-label">{t("auth.email_code")}</span>
              <div className="auth-code-row">
                <input
                  name="code"
                  required
                  maxLength="8"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={t("auth.code_placeholder")}
                />
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={sending || cooldown > 0}
                >
                  {sending
                    ? t("auth.sending")
                    : cooldown > 0
                      ? t("auth.resend_in", { seconds: cooldown })
                      : codeSent
                        ? t("auth.resend")
                        : t("auth.send_code")}
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
          <span>{t("auth.consent")}</span>
        </label>

        {submitError ? (
          <p className="auth-error" role="alert">
            {submitError}
          </p>
        ) : null}

        <button className="auth-submit" disabled={!agreed}>
          {t("auth.login_button")}
        </button>
      </Form>

      <div className="auth-links">
        <span>
          {t("auth.no_account")}
          <button type="button" className="auth-link" onClick={onRegister}>
            {t("auth.register_link")}
          </button>
        </span>
        <button
          type="button"
          className="auth-link"
          onClick={() => setForgotOpen(true)}
        >
          {t("auth.forgot_link")}
        </button>
      </div>

      <ForgotPasswordPanel
        open={forgotOpen}
        initialEmail={email}
        onClose={() => setForgotOpen(false)}
      />

      <CaptchaChallenge
        open={challengeOpen}
        title={challengeKind === "send-code" ? t("auth.confirm_send_code") : t("auth.confirm_login")}
        reason={challengeKind === "send-code" ? t("auth.human_check_send") : t("auth.human_check_login")}
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
