import React, { useEffect, useRef, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { api } from "@/shared/api/client.js";
import { navigate } from "@/shared/router/index.js";
import { toast } from "@/shared/ui/toast-api.js";
import { useAuth } from "../context.js";
import { CaptchaChallenge } from "./CaptchaChallenge.jsx";
import { EnterpriseApplyPanel } from "./EnterpriseApplyPanel.jsx";
import { BuildingIcon, UserIcon } from "@/shared/ui/icons.jsx";

// 注册与工作台完全同源：同一张邀请码表、同一套邮箱验证码与人机验证。
// 版式对齐工作台 LoginPage：个人 / 企业双意图；个人走邮箱验证码注册，
// 企业走线下申请（填表 + 加微信客服开通，不调后端接口）。
// 本页只负责交互，所有校验与下发都在工作台服务端完成。

// 发码冷却 60 秒（与工作台 registerCodeCooldown 同一口径）。
const CODE_COOLDOWN_SECONDS = 60;

export function RegisterForm({ onDone }) {
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
      toast("请先填写邮箱", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
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
        purpose: "register",
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

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label="注册身份">
        <button
          type="button"
          role="tab"
          aria-selected={intent === "personal"}
          className={`auth-tab ${intent === "personal" ? "is-active" : ""}`}
          onClick={() => setIntent("personal")}
        >
          <UserIcon size={14} />
          个人注册
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={intent === "enterprise"}
          className={`auth-tab ${intent === "enterprise" ? "is-active" : ""}`}
          onClick={() => setIntent("enterprise")}
        >
          <BuildingIcon size={14} />
          企业注册
        </button>
      </div>

      {intent === "enterprise" ? (
        <EnterpriseApplyPanel />
      ) : (
        <Form
          className="auth-form"
          success="注册成功"
          onSave={async (form) => {
            const password = String(form.get("password"));
            if (password !== String(form.get("confirm_password"))) {
              throw new Error("两次输入的密码不一致");
            }
            if (!codeSent) throw new Error("请先获取邮箱验证码");
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
            <span className="auth-label">手机号 *</span>
            <span className="auth-phone-row">
              <span className="auth-phone-prefix" aria-hidden="true">+86</span>
              <input
                name="phone"
                inputMode="numeric"
                autoComplete="tel"
                required
                pattern="1[3-9][0-9]{9}"
                maxLength="11"
                placeholder="请输入 11 位手机号"
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
              />
            </span>
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
              <button type="button" onClick={requestCode} disabled={sending || cooldown > 0}>
                {sending ? "发送中…" : cooldown > 0 ? `${cooldown}s 后重发` : codeSent ? "重新发送" : "发送验证码"}
              </button>
            </div>
          </label>

          <label className="auth-field">
            <span className="auth-label">密码 *</span>
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
            <span className="auth-label">确认密码 *</span>
            <input
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
              minLength="8"
              maxLength="72"
              placeholder="请再输入一次密码"
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">邀请码 *</span>
            <input
              name="invite_code"
              required
              maxLength="32"
              autoCapitalize="characters"
              placeholder="请输入注册邀请码"
            />
          </label>

          <div className="auth-optional">
            <button
              type="button"
              className="auth-optional-toggle"
              aria-expanded={extrasOpen}
              onClick={() => setExtrasOpen((open) => !open)}
            >
              {extrasOpen ? "收起可选信息" : "更多选项（可选）"}
            </button>
            {extrasOpen && (
              <label className="auth-field">
                <span className="auth-label">姓名 / 显示名</span>
                <input name="display_name" maxLength="60" placeholder="选填" />
              </label>
            )}
          </div>

          <p className="auth-help">
            注册时邮箱与手机号均为必填；需先完成邮箱验证码验证。企业/团队账号由公司管理员在工作台后台创建，此处仅开放个人注册。
          </p>

          <button className="auth-submit">注册并进入</button>
        </Form>
      )}

      <CaptchaChallenge
        open={challengeOpen}
        title="真人验证"
        reason="发送邮箱验证码前需要确认这一步由真人完成，防止恶意注册。"
        onCancel={() => setChallengeOpen(false)}
        onSolved={(code, id) => {
          setChallengeOpen(false);
          if (code && id) void sendCode(id, code);
        }}
      />

      <div className="auth-links">
        <span>
          已有账号？
          <button type="button" className="auth-link" onClick={onDone}>
            登录
          </button>
        </span>
      </div>
    </>
  );
}
