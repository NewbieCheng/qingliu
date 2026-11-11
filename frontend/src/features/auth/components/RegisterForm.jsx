import React, { useEffect, useRef, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { api } from "@/shared/api/client.js";
import { navigate } from "@/shared/router/index.js";
import { toast } from "@/shared/ui/toast-api.js";
import { useAuth } from "../context.js";
import { CaptchaChallenge } from "./CaptchaChallenge.jsx";
import { EnterpriseApplyPanel } from "./EnterpriseApplyPanel.jsx";
import { BuildingIcon, UserIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

// 注册与工作台完全同源：同一张邀请码表、同一套邮箱验证码与人机验证。
// 版式对齐工作台 LoginPage：个人 / 企业双意图；个人走邮箱验证码注册，
// 企业走线下申请（填表 + 加微信客服开通，不调后端接口）。
// 本页只负责交互，所有校验与下发都在工作台服务端完成。

// 发码冷却 60 秒（与工作台 registerCodeCooldown 同一口径）。
const CODE_COOLDOWN_SECONDS = 60;

export function RegisterForm({ onDone }) {
  const { t } = useI18n();
  const { register } = useAuth();
  const [intent, setIntent] = useState("personal");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // 人机验证不常驻：点「发送验证码」才弹挑战，通过后直接发码。
  // 凭据一次性有效，用完即焚，不存在表单里。
  const [challengeOpen, setChallengeOpen] = useState(false);
  const cooldownTimer = useRef(null);

  useEffect(
    () => () => {
      if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
    },
    [],
  );

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
    if (!email.trim()) {
      toast(t("auth.enter_email_first"), "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast(t("auth.invalid_email"), "error");
      return;
    }
    if (cooldown > 0 || sending) return;
    setChallengeOpen(true);
  }

  async function sendCode(captchaId, captchaCode) {
    setSending(true);
    try {
      await api("/api/auth/verification-codes", {
        target: email.trim(),
        purpose: "register",
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

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label={t("auth.register_identity")}>
        <button
          type="button"
          role="tab"
          aria-selected={intent === "personal"}
          className={`auth-tab ${intent === "personal" ? "is-active" : ""}`}
          onClick={() => setIntent("personal")}
        >
          <UserIcon size={14} />
          {t("auth.register_personal")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={intent === "enterprise"}
          className={`auth-tab ${intent === "enterprise" ? "is-active" : ""}`}
          onClick={() => setIntent("enterprise")}
        >
          <BuildingIcon size={14} />
          {t("auth.register_enterprise")}
        </button>
      </div>

      {intent === "enterprise" ? (
        <EnterpriseApplyPanel />
      ) : (
        <Form
          className="auth-form"
          success={t("auth.register_success")}
          onSave={async (form) => {
            const password = String(form.get("password"));
            if (password !== String(form.get("confirm_password"))) {
              throw new Error(t("auth.password_mismatch"));
            }
            if (!codeSent) throw new Error(t("auth.request_code_first"));
            await register({
              email: String(form.get("email")).trim(),
              phone: String(form.get("phone")).trim(),
              display_name: String(form.get("display_name")).trim(),
              password,
              code: String(form.get("code")).trim(),
              invite_code: String(form.get("invite_code")).trim(),
            });
            navigate("/");
          }}
        >
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
            <span className="auth-label">{t("auth.phone")} *</span>
            <span className="auth-phone-row">
              <span className="auth-phone-prefix" aria-hidden="true">+86</span>
              <input
                name="phone"
                inputMode="numeric"
                autoComplete="tel"
                required
                pattern="1[3-9][0-9]{9}"
                maxLength="11"
                placeholder={t("auth.phone_placeholder")}
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
              />
            </span>
          </label>

          <label className="auth-field">
            <span className="auth-label">{t("auth.email_code")} *</span>
            <div className="auth-code-row">
              <input
                name="code"
                required
                maxLength="8"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t("auth.code_placeholder")}
              />
              <button type="button" onClick={requestCode} disabled={sending || cooldown > 0}>
                {sending ? t("auth.sending") : cooldown > 0 ? t("auth.resend_in", { seconds: cooldown }) : codeSent ? t("auth.resend") : t("auth.send_code")}
              </button>
            </div>
          </label>

          <label className="auth-field">
            <span className="auth-label">{t("auth.password")} *</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength="8"
              maxLength="72"
              placeholder={t("auth.password_new_placeholder")}
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">{t("auth.confirm_password")} *</span>
            <input
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
              minLength="8"
              maxLength="72"
              placeholder={t("auth.confirm_password_placeholder")}
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">{t("auth.invite_code")} *</span>
            <input
              name="invite_code"
              required
              maxLength="32"
              autoCapitalize="characters"
              placeholder={t("auth.invite_code_placeholder")}
            />
          </label>

          <div className="auth-optional">
            <button
              type="button"
              className="auth-optional-toggle"
              aria-expanded={extrasOpen}
              onClick={() => setExtrasOpen((open) => !open)}
            >
              {extrasOpen ? t("auth.hide_options") : t("auth.more_options")}
            </button>
            {extrasOpen && (
              <label className="auth-field">
                <span className="auth-label">{t("auth.display_name")}</span>
                <input name="display_name" maxLength="60" placeholder={t("auth.optional")} />
              </label>
            )}
          </div>

          <p className="auth-help">
            {t("auth.register_note")}
          </p>

          <button className="auth-submit">{t("auth.register_button")}</button>
        </Form>
      )}

      <CaptchaChallenge
        open={challengeOpen}
        title={t("auth.captcha_title")}
        reason={t("auth.human_check_send")}
        onCancel={() => setChallengeOpen(false)}
        onSolved={(code, id) => {
          setChallengeOpen(false);
          if (code && id) void sendCode(id, code);
        }}
      />

      <div className="auth-links">
        <span>
          {t("auth.have_account")}
          <button type="button" className="auth-link" onClick={onDone}>
            {t("auth.sign_in_link")}
          </button>
        </span>
      </div>
    </>
  );
}
