import React from "react";

export function FormRow({ label, hint, children }) {
  return (
    <div className="ql-row">
      <span className="ql-row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <div className="ql-row-control">{children}</div>
    </div>
  );
}

export function Select({ label, className = "", children, ...rest }) {
  return (
    <select
      className={`ql-select${className ? ` ${className}` : ""}`}
      aria-label={rest["aria-label"] || label}
      {...rest}
    >
      {children}
    </select>
  );
}
