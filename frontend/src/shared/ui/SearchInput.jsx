import React from "react";
import { XIcon } from "./icons.jsx";

// 搜索框：有字时框内右侧出现 × 一键清空。
// 受控组件：value/onChange 传字符串本身，不是事件。
export function SearchInput({ value, onChange, clearLabel = "清除搜索", ...rest }) {
  return (
    <span className="ql-search">
      <input value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
      {value && (
        <button
          type="button"
          className="ql-search-clear"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => onChange("")}
        >
          <XIcon size={13} />
        </button>
      )}
    </span>
  );
}
