import React, { useCallback, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { useAuth } from "../context.js";
import { navigate } from "@/shared/router/index.js";
import { LoginPassword } from "./LoginPassword.jsx";
import { CaptchaField } from "./CaptchaField.jsx";

// 仅本地开发（vite dev）用：从 frontend/.env.local 读预填账号，构建产物里为空。
const devUsername = import.meta.env.DEV
  ? import.meta.env.VITE_DEV_LOGIN_USERNAME || ""
  : "";

// 1=个人，2=团队。团队/公司账号由工作台后台创建，清流只负责登录。
const LOGIN_MODES = [
  { value: 1, label: "个人登录" },
  { value: 2, label: "企业登录" },
];

export function LoginForm({ onRegister }) {
  const { login, rememberedUsername, rememberUsername } = useAuth();
  const [mode, setMode] = useState(1);
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaID, setCaptchaID] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [agreed, setAgreed] = useState(true);
  // 登录失败原因（常驻显示，不依赖 toast）
  const [submitError, setSubmitError] = useState("");

  const handleCaptcha = useCallback((code, id) => {
    setCaptchaCode(code);
    if (id) setCaptchaID(id);
  }, []);

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label="登录方式">
        {LOGIN_MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={item.value === mode}
            className={`auth-tab ${item.value === mode ? "is-active" : ""}`}
            onClick={() => {
              setMode(item.value);
              setSubmitError("");
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Form
        className="auth-form"
        success="登录成功"
        onSave={async (form) => {
          if (!agreed) throw new Error("请先阅读并同意用户协议与隐私政策");
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
            // 登录页必须**常驻**显示失败原因：只弹 toast 的话，用户看到的
            // 是「已完成人机验证」但页面毫无反应，完全不知道发生了什么。
            setSubmitError(error?.message || "登录失败，请重试");
            throw error;
          }
          setSubmitError("");
          rememberUsername(username, true);
          navigate("/");
        }}
      >
        <label className="auth-field">
          <span className="auth-label">工作邮箱 / 手机号</span>
          <input
            name="username"
            autoComplete="username"
            defaultValue={rememberedUsername || devUsername}
            required
            maxLength="120"
            placeholder={mode === 2 ? "请输入公司团队账号" : "请输入工作台账号"}
          />
        </label>

        <label className="auth-field">
          <span className="auth-label">密码</span>
          <LoginPassword />
        </label>

        <div className="auth-field">
          <span className="auth-label">人机验证</span>
          <CaptchaField
            key={captchaKey}
            value={captchaCode}
            onChange={handleCaptcha}
            onError={() => {}}
          />
        </div>

        <label className="auth-agree">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>
            我已阅读并同意《用户协议》与《隐私政策》
          </span>
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
        <span className="auth-help">忘记密码请联系管理员</span>
      </div>
    </>
  );
}
