import React from "react";
export { Select } from "./Select.jsx";

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
