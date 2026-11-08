import React from "react";

export function Loading({ text = "正在加载…", error = "", onRetry, compact = false }) {
  if (error) {
    return (
      <div className={`ql-loading${compact ? " compact" : ""}`} role="alert">
        <p className="error">{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            重新加载
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
      <span className="ql-loading-text">{text}</span>
    </div>
  );
}
