import React from "react";

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}
