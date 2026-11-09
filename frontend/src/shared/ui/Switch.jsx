import React from "react";

// 开关：原生 checkbox 的统一样式外壳，整格可点、键盘可达。
// 直接透传 name/defaultChecked，所有表单取值逻辑（FormData.has/get）不变。
export function Switch({ label, ...rest }) {
  return (
    <label className="ql-switch-wrap">
      <input type="checkbox" className="ql-switch-input" aria-label={label} {...rest} />
      <span className="ql-switch" aria-hidden="true">
        <span className="ql-switch-knob" />
      </span>
    </label>
  );
}
