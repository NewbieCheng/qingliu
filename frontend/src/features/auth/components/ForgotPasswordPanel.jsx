import React, { useEffect, useRef, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { api } from "@/shared/api/client.js";
import { toast } from "@/shared/ui/toast-api.js";
import { CaptchaChallenge } from "./CaptchaChallenge.jsx";

const WECHAT_ID = "sihai332211";
const CODE_COOLDOWN_SECONDS = 60;

export function ForgotPasswordPanel({ open, onClose, initialEmail = "" }) {
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
      toast("请先填写邮箱", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      toast("邮箱格式不正确", "error");
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
      toast("验证码已发送请查收邮箱");
    } catch (error) {
      toast(error.message || "验证码发送失败", "error");
    } finally {
      setSending(false);
    }
  }

  async function copyWechat() {
    try {
      await navigator.clipboard.writeText(WECHAT_ID);
      toast("微信号已复制");
    } catch {
      toast("复制失败请手动复制", "error");
    }
  }

  const title =
    step === "email"
      ? "邮箱验证改密"
      : step === "admin"
        ? "联系管理员重置"
        : "找回密码";

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
              aria-label="关闭"
              onClick={onClose}
            >
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </header>

          {step === "choose" ? (
            <>
              <p className="auth-modal-reason">请选择一种找回方式</p>
              <div className="auth-forgot-choices">
                <button
                  type="button"
                  className="auth-forgot-choice"
                  onClick={() => setStep("email")}
                >
                  <strong>邮箱验证改密</strong>
                  <span>向注册邮箱发送验证码，验证通过后设置新密码</span>
                </button>
                <button
                  type="button"
                  className="auth-forgot-choice"
                  onClick={() => setStep("admin")}
                >
                  <strong>联系管理员重置</strong>
                  <span>添加微信客服，由管理员协助重置密码</span>
                </button>
              </div>
            </>
          ) : null}

          {step === "email" ? (
            <>
              <p className="auth-modal-reason">
                验证码发送到注册邮箱，通过后即可设置新密码。
              </p>
              <Form
                className="auth-form"
                success="密码已重置，请使用新密码登录"
                onSave={async (form) => {
                  if (!codeSent) throw new Error("请先获取邮箱验证码");
                  const password = String(form.get("password"));
                  if (password !== String(form.get("confirm_password"))) {
                    throw new Error("两次输入的密码不一致");
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
                  <span className="auth-label">邮箱 *</span>
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
                  <span className="auth-label">邮箱验证码 *</span>
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

                <label className="auth-field">
                  <span className="auth-label">新密码 *</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength="8"
                    maxLength="72"
                    placeholder="至少 8 位，含字母与数字"
                  />
                </label>

                <label className="auth-field">
                  <span className="auth-label">确认新密码 *</span>
                  <input
                    name="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength="8"
                    maxLength="72"
                    placeholder="再次输入新密码"
                  />
                </label>

                <div className="auth-forgot-actions">
                  <button
                    type="button"
                    className="auth-ghost"
                    onClick={() => setStep("choose")}
                  >
                    返回
                  </button>
                  <button className="auth-submit" type="submit">
                    确认改密
                  </button>
                </div>
              </Form>
            </>
          ) : null}

          {step === "admin" ? (
            <>
              <p className="auth-modal-reason">
                请按以下步骤联系专属客服，我们将协助您重置密码。
              </p>
              <ol className="auth-wechat-steps">
                <li>
                  <span className="auth-wechat-step-no">1</span>
                  复制下方微信号，打开微信添加好友
                </li>
                <li>
                  <span className="auth-wechat-step-no">2</span>
                  说明需要重置密码，并提供账号邮箱
                </li>
                <li>
                  <span className="auth-wechat-step-no">3</span>
                  等待管理员重置后使用新密码登录
                </li>
              </ol>
              <div className="auth-wechat-card">
                <span className="auth-wechat-label">联系微信客服：</span>
                <span className="auth-wechat-id">{WECHAT_ID}</span>
                <button type="button" className="auth-verify-btn" onClick={() => void copyWechat()}>
                  复制微信号
                </button>
              </div>
              <div className="auth-forgot-actions">
                <button
                  type="button"
                  className="auth-ghost"
                  onClick={() => setStep("choose")}
                >
                  返回
                </button>
                <button type="button" className="auth-modal-primary" onClick={onClose}>
                  我知道了
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <CaptchaChallenge
        open={challengeOpen}
        title="发送验证码前确认"
        reason="发送重置密码验证码前需要确认这一步由真人完成。"
        onCancel={() => setChallengeOpen(false)}
        onSolved={(code, id) => {
          setChallengeOpen(false);
          if (code && id) void sendCode(id, code);
        }}
      />
    </>
  );
}
