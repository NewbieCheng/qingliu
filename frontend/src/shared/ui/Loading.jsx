import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";

export function Loading({ text, error = "", onRetry, compact = false }) {
  const { t } = useI18n();
  const loadingText = text ?? t("common.loading");
  if (error) {
    return (
      <div className={`ql-loading${compact ? " compact" : ""}`} role="alert">
        <p className="error">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            {t("common.retry")}
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      className={`ql-loading${compact ? " compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="ql-spinner" aria-hidden="true" />
      <span className="ql-loading-text">{loadingText}</span>
    </div>
  );
}
