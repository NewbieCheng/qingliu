import React, { useCallback, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { api } from "@/shared/api/client.js";
import { navigate } from "@/shared/router/index.js";
import { toast } from "@/shared/ui/toast-api.js";
import { useAuth } from "../context.js";
import { CaptchaField } from "./CaptchaField.jsx";

// 注册与工作台完全同源：同一张邀请码表、同一套邮箱验证码与人机验证。
// 本页只负责交互，所有校验与发分都在工作台服务端完成。

export function RegisterForm({ onDone }) {
  const { register } = useAuth();
  const [captcha, setCaptcha] = useState(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [answer, setAnswer] = useState("");

  // 人机验证由 CaptchaField 完成；这里保存它回传的 id/code，
  // 发邮箱验证码时必须一并带上（工作台要求先过人机校验才能发码）。
  const handleCaptcha = useCallback((code, id) => {
    setAnswer(code);
    setCaptcha({ captcha_id: id });
  }, []);

  async function sendCode() {
    if (!email.trim()) {
      toast("请先填写邮箱", "error");
      return;
    }
    if (!answer.trim()) {
      toast("请先完成人机验证", "error");
      return;
    }
    setSending(true);
    try {
      await api("/api/auth/verification-codes", {
        target: email.trim(),
        purpose: "register",
        captcha_id: captcha?.captcha_id || "",
        captcha_code: answer.trim(),
      });
      setCodeSent(true);
      toast("验证码已发送到邮箱");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label="注册">
        <button type="button" className="auth-tab" onClick={onDone}>
          返回登录
        </button>
        <button type="button" className="auth-tab is-active" aria-selected="true">
          注册账号
        </button>
      </div>

      <Form
        className="auth-form"
        success="注册成功"
        onSave={async (form) => {
          if (!codeSent) throw new Error("请先获取邮箱验证码");
          await register({
            email: String(form.get("email")).trim(),
            phone: String(form.get("phone")).trim(),
            display_name: String(form.get("display_name")).trim(),
            password: String(form.get("password")),
            code: String(form.get("code")).trim(),
            invite_code: String(form.get("invite_code")).trim(),
            login_mode: 1,
          });
          navigate("/");
        }}
      >
        <label className="auth-field">
          <span className="auth-label">邮箱</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength="120"
            placeholder="用于接收验证码和登录"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">手机号</span>
          <input
            name="phone"
            inputMode="numeric"
            autoComplete="tel"
            required
            pattern="1[3-9][0-9]{9}"
            maxLength="11"
            placeholder="11 位手机号"
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">姓名 / 显示名</span>
          <input name="display_name" maxLength="60" placeholder="选填" />
        </label>

        <label className="auth-field">
          <span className="auth-label">密码</span>
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
          <span className="auth-label">邀请码</span>
          <input
            name="invite_code"
            required
            maxLength="32"
            autoCapitalize="characters"
            placeholder="由管理员提供"
          />
        </label>

        <div className="auth-field">
          <span className="auth-label">人机验证</span>
          <CaptchaField value={answer} onChange={handleCaptcha} />
        </div>

        <label className="auth-field">
          <span className="auth-label">邮箱验证码</span>
          <div className="login-code-row">
            <input
              name="code"
              required
              maxLength="8"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 位验证码"
            />
            <button type="button" className="ghost" onClick={sendCode} disabled={sending}>
              {sending ? "发送中…" : codeSent ? "重新发送" : "获取验证码"}
            </button>
          </div>
        </label>

        <p className="auth-help">
          企业/团队账号由公司管理员在工作台后台创建，此处仅开放个人注册。
        </p>

        <button className="auth-submit">注册并进入</button>
      </Form>
    </>
  );
}
