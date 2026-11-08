import React, { useCallback, useEffect, useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { api } from "@/shared/api/client.js";
import { navigate } from "@/shared/router/index.js";
import { toast } from "@/shared/ui/toast-api.js";
import { useAuth } from "../context.js";

// 注册与工作台完全同源：同一张邀请码表、同一套邮箱验证码与图形验证码。
// 本页只负责交互，所有校验与发分都在工作台服务端完成。

export function RegisterForm() {
  const { register } = useAuth();
  const [captcha, setCaptcha] = useState(null);
  const [captchaError, setCaptchaError] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [answer, setAnswer] = useState("");

  const loadCaptcha = useCallback(async () => {
    setCaptchaError("");
    try {
      setCaptcha(await api("/api/auth/captcha?type=image"));
      setAnswer("");
    } catch (error) {
      setCaptchaError(error.message);
    }
  }, []);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  async function sendCode() {
    if (!email.trim()) {
      toast("请先填写邮箱", "error");
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
      void loadCaptcha();
    } finally {
      setSending(false);
    }
  }

  return (
    <Form
      className="login-form"
      success="注册成功"
      onSave={async (form) => {
        if (!codeSent) {
          throw new Error("请先获取邮箱验证码");
        }
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
      <Field label="邮箱">
        <div className="login-input">
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
        </div>
      </Field>
      <Field label="手机号">
        <div className="login-input">
          <input
            name="phone"
            inputMode="numeric"
            autoComplete="tel"
            required
            pattern="1[3-9][0-9]{9}"
            maxLength="11"
            placeholder="11 位手机号"
          />
        </div>
      </Field>
      <Field label="姓名 / 显示名">
        <div className="login-input">
          <input name="display_name" maxLength="60" placeholder="选填" />
        </div>
      </Field>
      <Field label="密码">
        <div className="login-input">
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength="8"
            maxLength="72"
            placeholder="至少 8 位，含字母与数字"
          />
        </div>
      </Field>
      <Field label="邀请码">
        <div className="login-input">
          <input
            name="invite_code"
            required
            maxLength="32"
            autoCapitalize="characters"
            placeholder="由管理员提供"
          />
        </div>
      </Field>
      <Field label="邮箱验证码">
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
      </Field>
      <Field label="图形验证码">
        <div className="login-code-row">
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            required
            maxLength="8"
            placeholder="按图片填写"
          />
          {captcha?.image ? (
            <button
              type="button"
              className="login-captcha"
              onClick={loadCaptcha}
              title="点击换一张"
            >
              <img
                src={
                  captcha.image.startsWith("data:")
                    ? captcha.image
                    : `data:image/png;base64,${captcha.image}`
                }
                alt="图形验证码"
              />
            </button>
          ) : (
            <button type="button" className="ghost" onClick={loadCaptcha}>
              加载验证码
            </button>
          )}
        </div>
      </Field>
      {captchaError && (
        <p className="upload-error" role="alert">
          {captchaError}
        </p>
      )}
      <p className="login-panel-desc login-register-note">
        团队账号由公司管理员在工作台后台创建，注册页仅开放个人账号。
      </p>
      <button className="primary login-submit">注册并进入</button>
    </Form>
  );
}
