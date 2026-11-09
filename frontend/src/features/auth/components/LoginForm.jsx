import React, { useCallback, useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { ArrowRightIcon, UserIcon } from "@/shared/ui/icons.jsx";
import { useAuth } from "../context.js";
import { navigate } from "@/shared/router/index.js";
import { LoginPassword } from "./LoginPassword.jsx";
import { CaptchaField } from "./CaptchaField.jsx";

// 仅本地开发（vite dev）用：从 frontend/.env.local 读预填账号，构建产物里为空。
const devUsername = import.meta.env.DEV
  ? import.meta.env.VITE_DEV_LOGIN_USERNAME || ""
  : "";

// 1=个人，2=团队。团队/公司账号仍由工作台后台创建，清流只负责登录。
const LOGIN_MODES = [
  { value: 1, label: "个人登录", hint: "使用个人账号进入客户资料工作台" },
  { value: 2, label: "团队登录", hint: "使用公司团队账号登录，权限由团队管理员分配" },
];

export function LoginForm({ mode = 1, onModeChange }) {
  const { login, rememberedUsername, rememberUsername } = useAuth();
  const current = LOGIN_MODES.find((item) => item.value === mode) || LOGIN_MODES[0];
  // 验证码与工作台网页登录同一要求：密码登录必须过人机校验。
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaID, setCaptchaID] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);

  const handleCaptcha = useCallback((code, id) => {
    setCaptchaCode(code);
    if (id) setCaptchaID(id);
  }, []);

  return (
    <>
      <div className="login-tabs" role="tablist" aria-label="登录方式">
        {LOGIN_MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={item.value === mode}
            className={`login-tab ${item.value === mode ? "is-active" : ""}`}
            onClick={() => onModeChange?.(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="login-mode-hint">{current.hint}</p>
      <Form
        className="login-form"
        success="登录成功"
        onSave={async (form) => {
          const username = String(form.get("username")).trim();
          try {
            await login({
              username,
              password: form.get("password"),
              login_mode: mode,
              captcha_id: captchaID,
              captcha_code: captchaCode.trim(),
            });
          } catch (error) {
            // 验证码一次性有效：任何失败都换一张，避免用户拿旧图重试。
            setCaptchaKey((value) => value + 1);
            throw error;
          }
          rememberUsername(username, form.get("remember"));
          navigate("/");
        }}
      >
        <input type="hidden" name="login_mode" value={mode} />
        <Field label={mode === 2 ? "团队账号（邮箱或手机号）" : "账号"}>
          <div className="login-input">
            <UserIcon />
            <input
              name="username"
              autoComplete="username"
              defaultValue={rememberedUsername || devUsername}
              required
              maxLength="120"
              placeholder={mode === 2 ? "请输入公司团队账号" : "请输入工作台账号"}
            />
          </div>
        </Field>
        <Field label="密码">
          <LoginPassword />
        </Field>
        <Field label="验证码">
          <CaptchaField
            key={captchaKey}
            value={captchaCode}
            onChange={handleCaptcha}
            onError={setCaptchaError}
          />
          {captchaError && <p className="error">{captchaError}</p>}
        </Field>
        <div className="login-options">
          <label className="login-remember">
            <input
              type="checkbox"
              name="remember"
              defaultChecked={Boolean(rememberedUsername)}
            />
            记住账号
          </label>
          <span className="login-help">忘记密码请联系管理员</span>
        </div>
        <button className="primary login-submit">
          进入工作台
          <ArrowRightIcon />
        </button>
      </Form>
    </>
  );
}
