import React, { useState } from "react";
import { EyeIcon, LockIcon } from "@/shared/ui/icons.jsx";

export function LoginPassword() {
  const [show, setShow] = useState(false);
  // 仅本地开发（vite dev）用：从 frontend/.env.local 读预填密码，构建产物里为空。
  const devPassword = import.meta.env.DEV
    ? import.meta.env.VITE_DEV_LOGIN_PASSWORD || ""
    : "";
  return (
    <div className="login-input">
      <LockIcon />
      <input
        name="password"
        type={show ? "text" : "password"}
        autoComplete="current-password"
        defaultValue={devPassword}
        required
        maxLength="72"
        placeholder="请输入密码"
      />
      <button
        type="button"
        className="login-eye"
        aria-label={show ? "隐藏密码" : "显示密码"}
        onClick={() => setShow((value) => !value)}
      >
        <EyeIcon off={show} />
      </button>
    </div>
  );
}
