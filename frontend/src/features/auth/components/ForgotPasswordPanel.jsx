import React, { useEffect, useRef, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { api } from "@/shared/api/client.js";
import { toast } from "@/shared/ui/toast-api.js";
import { CaptchaChallenge } from "./CaptchaChallenge.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

const WECHAT_ID = "sihai332211";
const CODE_COOLDOWN_SECONDS = 60;

export function ForgotPasswordPanel({ open, onClose, initialEmail = "" }) {
  const { t } = useI18n();
  // choose | email | admin
  const [step, setStep] = useState("choose");
  const [email, setEmail] = useState(initialEmail);
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const cooldownTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setEmail(initialEmail || "");
    setCodeSent(false);
    setSending(false);
    setCooldown(0);
    setChallengeOpen(false);
  }, [open, initialEmail]);

  useEffect(
    () => () => {
      if (cooldownTimer.current) window.clearInterval(cooldownTimer.current);
    },
    [],
  );

  if (!open) return null;

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
  }

  async function sendCode(captchaId, captchaCode) {
    setSending(true);
    try {
      await api("/api/auth/verification-codes", {
        target: email.trim(),
        purpose: "reset_password",
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

  async function copyWechat() {
    try {
      await navigator.clipboard.writeText(WECHAT_ID);
      toast(t("auth.wechat_copied"));
    } catch {
      toast(t("auth.copy_failed"), "error");
    }
  }

  const title =
    step === "email"
      ? t("auth.forgot_email_title")
      : step === "admin"
        ? t("auth.forgot_admin_title")
        : t("auth.forgot_title");

  return (
    <>
      <div
        className="auth-modal"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose?.();
        }}
      >
        <div
          className="auth-modal-sheet auth-forgot-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-forgot-title"
        >
          <header className="auth-modal-head">
            <h2 id="auth-forgot-title">{title}</h2>
            <button
              type="button"
              className="auth-modal-close"
              aria-label={t("common.close")}
              onClick={onClose}
            >
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </header>

          {step === "choose" ? (
            <>
              <p className="auth-modal-reason">{t("auth.forgot_choose")}</p>
              <div className="auth-forgot-choices">
                <button
                  type="button"
                  className="auth-forgot-choice"
                  onClick={() => setStep("email")}
                >
                  <strong>{t("auth.forgot_email_title")}</strong>
                  <span>{t("auth.forgot_email_desc")}</span>
                </button>
                <button
                  type="button"
                  className="auth-forgot-choice"
                  onClick={() => setStep("admin")}
                >
                  <strong>{t("auth.forgot_admin_title")}</strong>
                  <span>{t("auth.forgot_admin_desc")}</span>
                </button>
              </div>
            </>
          ) : null}

          {step === "email" ? (
            <>
              <p className="auth-modal-reason">
                {t("auth.forgot_code_note")}
              </p>
              <Form
                className="auth-form"
                success={t("auth.password_reset_success")}
                onSave={async (form) => {
                  if (!codeSent) throw new Error(t("auth.request_code_first"));
                  const password = String(form.get("password"));
                  if (password !== String(form.get("confirm_password"))) {
                    throw new Error(t("auth.password_mismatch"));
                  }
                  await api("/api/auth/reset-password", {
                    email: email.trim(),
                    code: String(form.get("code")).trim(),
                    new_password: password,
                  });
                  onClose?.();
                }}
              >
                <label className="auth-field">
                  <span className="auth-label">{t("auth.email")} *</span>
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
                    <button
                      type="button"
                      onClick={requestCode}
                      disabled={sending || cooldown > 0}
                    >
                      {sending ? t("auth.sending") : cooldown > 0 ? t("auth.resend_in", { seconds: cooldown }) : codeSent ? t("auth.resend") : t("auth.send_code")}
                    </button>
                  </div>
                </label>

                <label className="auth-field">
                  <span className="auth-label">{t("auth.new_password")} *</span>
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
                  <span className="auth-label">{t("auth.confirm_new_password")} *</span>
                  <input
                    name="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength="8"
                    maxLength="72"
                    placeholder={t("auth.confirm_new_password_placeholder")}
                  />
                </label>

                <div className="auth-forgot-actions">
                  <button
                    type="button"
                    className="auth-ghost"
                    onClick={() => setStep("choose")}
                  >
                    {t("common.back")}
                  </button>
                  <button className="auth-submit" type="submit">
                    {t("auth.confirm_reset")}
                  </button>
                </div>
              </Form>
            </>
          ) : null}

          {step === "admin" ? (
            <>
              <p className="auth-modal-reason">
                {t("auth.admin_reset_steps")}
              </p>
              <ol className="auth-wechat-steps">
                <li>
                  <span className="auth-wechat-step-no">1</span>
                  {t("auth.copy_wechat_steps")}
                </li>
                <li>
                  <span className="auth-wechat-step-no">2</span>
                  {t("auth.tell_admin_reset")}
                </li>
                <li>
                  <span className="auth-wechat-step-no">3</span>
                  {t("auth.wait_admin_reset")}
                </li>
              </ol>
              <div className="auth-wechat-card">
                <span className="auth-wechat-label">{t("auth.wechat_support")}</span>
                <span className="auth-wechat-id">{WECHAT_ID}</span>
                <button type="button" className="auth-verify-btn" onClick={() => void copyWechat()}>
                  {t("auth.copy_wechat")}
                </button>
              </div>
              <div className="auth-forgot-actions">
                <button
                  type="button"
                  className="auth-ghost"
                  onClick={() => setStep("choose")}
                >
                  {t("common.back")}
                </button>
                <button type="button" className="auth-modal-primary" onClick={onClose}>
                  {t("auth.got_it")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <CaptchaChallenge
        open={challengeOpen}
        title="Confirm before sending code"
        reason="Confirm you are human before sending the reset-password code."
        onCancel={() => setChallengeOpen(false)}
        onSolved={(code, id) => {
          setChallengeOpen(false);
          if (code && id) void sendCode(id, code);
        }}
      />
    </>
  );
}
