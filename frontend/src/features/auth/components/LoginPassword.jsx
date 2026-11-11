import React, { useState } from "react";
import { EyeIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

export function LoginPassword({ value, onChange, defaultValue = "" }) {
  const { t } = useI18n();
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
        placeholder={t("auth.password_placeholder")}
      />
      <button
        type="button"
        className="auth-eye"
        aria-label={show ? t("captcha.password_hide") : t("captcha.password_show")}
        onClick={() => setShow((current) => !current)}
      >
        <EyeIcon off={show} />
      </button>
    </span>
  );
}
