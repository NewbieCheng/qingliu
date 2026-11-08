import React, { useState } from "react";
import { EyeIcon, LockIcon } from "@/shared/ui/icons.jsx";

export function LoginPassword() {
  const [show, setShow] = useState(false);
  return (
    <div className="login-input">
      <LockIcon />
      <input
        name="password"
        type={show ? "text" : "password"}
        autoComplete="current-password"
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
