import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";

/** 主文案展示错误；请求号收进「查看更多」，避免污染中文界面。 */
export function RequestErrorAlert({ message, requestId, className = "error" }) {
  const { t } = useI18n();
  if (!message) return null;
  const shortId = requestId ? String(requestId).slice(0, 8) : "";

  return (
    <div className={className} role="alert">
      <p className="request-error-message">{message}</p>
      {shortId ? (
        <details className="request-error-more">
          <summary>{t("error.show_more")}</summary>
          <p className="muted">
            {t("error.request_label")} <code>{shortId}</code>
          </p>
        </details>
      ) : null}
    </div>
  );
}
