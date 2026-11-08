import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { ArrowRightIcon, UserIcon } from "@/shared/ui/icons.jsx";
import { useAuth } from "../context.js";
import { navigate } from "@/shared/router/index.js";
import { LoginPassword } from "./LoginPassword.jsx";

// 仅本地开发（vite dev）用：从 frontend/.env.local 读预填账号，构建产物里为空。
const devUsername = import.meta.env.DEV
  ? import.meta.env.VITE_DEV_LOGIN_USERNAME || ""
  : "";

export function LoginForm() {
  const { login, rememberedUsername, rememberUsername } = useAuth();

  return (
    <Form
      className="login-form"
      success="登录成功"
      onSave={async (form) => {
        const username = String(form.get("username"));
        await login(Object.fromEntries(form));
        rememberUsername(username, form.get("remember"));
        navigate("/");
      }}
    >
      <Field label="账号">
        <div className="login-input">
          <UserIcon />
          <input
            name="username"
            autoComplete="username"
            defaultValue={rememberedUsername || devUsername}
            required
            maxLength="60"
            placeholder="请输入工作台账号"
          />
        </div>
      </Field>
      <Field label="密码">
        <LoginPassword />
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
  );
}
