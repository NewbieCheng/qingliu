import React from "react";

export function StatusBadge({ tone = "default", children, className = "" }) {
  const toneClass = tone === "default" ? "" : tone;
  return (
    <span className={`badge ${toneClass} ${className}`.trim()}>{children}</span>
  );
}
