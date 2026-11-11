import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";

/**
 * 语言切换按钮组件：zh-CN <-> en-US 切换
 */
export function LanguageSwitch({ className = "" }) {
  const { locale, setLocale, t } = useI18n();

  const isEn = locale === "en-US";

  function toggle() {
    setLocale(isEn ? "zh-CN" : "en-US");
  }

  return (
    <button
      type="button"
      className={`ghost lang-switch-btn ${className}`.trim()}
      onClick={toggle}
      title={`${t("topbar.lang")}: ${isEn ? t("topbar.lang.zh") : t("topbar.lang.en")}`}
      aria-label={`${t("topbar.lang")}: ${isEn ? t("topbar.lang.zh") : t("topbar.lang.en")}`}
    >
      <span>{isEn ? t("topbar.lang.zh") : "EN"}</span>
    </button>
  );
}
