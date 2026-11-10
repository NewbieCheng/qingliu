import React, { useState } from "react";
import { EyeIcon } from "@/shared/ui/icons.jsx";

export function LoginPassword({ value, onChange, defaultValue = "" }) {
  const [show, setShow] = useState(false);
  const controlled = value !== undefined;
  return (
    <span className="auth-input-wrap">
      <input
        name="password"
        type={show ? "text" : "password"}
        autoComplete="current-password"
        {...(controlled
          ? { value, onChange }
          : { defaultValue })}
        required
        maxLength="72"
        placeholder="请输入密码"
      />
      <button
        type="button"
        className="auth-eye"
        aria-label={show ? "隐藏密码" : "显示密码"}
        onClick={() => setShow((current) => !current)}
      >
        <EyeIcon off={show} />
      </button>
    </span>
  );
}
