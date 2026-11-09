import React, { useCallback, useRef, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { useAuth } from "../context.js";
import { navigate } from "@/shared/router/index.js";
import { LoginPassword } from "./LoginPassword.jsx";
import { CaptchaChallenge } from "./CaptchaChallenge.jsx";

// 仅本地开发（vite dev）用：从 frontend/.env.local 读预填账号，构建产物里为空。
const devUsername = import.meta.env.DEV
  ? import.meta.env.VITE_DEV_LOGIN_USERNAME || ""
  : "";

// 1=个人，2=团队。团队/公司账号由工作台后台创建，清流只负责登录。
// 默认企业登录：清流的主要使用者是评估机构的团队账号。
const LOGIN_MODES = [
  { value: 2, label: "企业登录" },
  { value: 1, label: "个人登录" },
];

// 用户取消人机验证时用它中断提交流程：它不是错误，不该弹错误 toast。
const CANCELLED = Object.assign(new Error("已取消人机验证"), { silent: true });

export function LoginForm({ onRegister }) {
  const { login, rememberedUsername, rememberUsername } = useAuth();
  const [mode, setMode] = useState(2);
  const [agreed, setAgreed] = useState(true);
  // 登录失败原因（常驻显示，不依赖 toast）
  const [submitError, setSubmitError] = useState("");
  // 人机验证：只有点了「登录」才弹出；通过后拿到一次性的 captcha 凭据。
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [captcha, setCaptcha] = useState({ id: "", code: "" });
  const waiter = useRef(null);

  const askCaptcha = useCallback(
    () =>
      new Promise((resolve) => {
        waiter.current = resolve;
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

          let answer = captcha;
          if (!answer.code) {
            const solved = await askCaptcha();
            if (!solved || solved === CANCELLED) throw CANCELLED;
            answer = solved;
            setCaptcha(solved);
          }

          try {
            await login({
              username,
              password: form.get("password"),
              login_mode: mode,
              captcha_id: answer.id,
              captcha_code: String(answer.code).trim(),
            });
          } catch (error) {
            // 验证码一次性有效：任何失败都作废，下次点登录重新出题。
            setCaptcha({ id: "", code: "" });
            // 登录失败原因常驻显示在表单里（只弹 toast 的话，用户看到的
            // 是「已完成人机验证」但页面毫无反应）。错误已在页内展示，
            // 改为静默抛出，避免 Form 再弹一次同样的 toast造成双报。
            setSubmitError(error?.message || "登录失败，请重试");
            error.silent = true;
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
        <span className="auth-help">忘记密码请联系管理员</span>
      </div>

      <CaptchaChallenge
        open={challengeOpen}
        title="登录前确认"
        reason="这次登录需要确认由真人操作。点完提示中的图标后，会继续登录。"
        onCancel={() => closeChallenge(CANCELLED)}
        onSolved={(code, id) => {
          if (!code) return;
          closeChallenge({ id, code });
        }}
      />
    </>
  );
}
