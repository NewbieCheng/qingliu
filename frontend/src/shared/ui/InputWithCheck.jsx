import React from "react";
import { CheckIcon } from "./icons.jsx";

// 带确认钮的输入框：框内右侧 ✓ 按钮，点后整框变绿表示"本行已确认"。
// 纯前端确认态（checked/onToggle 由调用方持有），不改变提交载荷。
export function InputWithCheck({
  checked = false,
  onToggle,
  checkLabel = "确认本行",
  ...rest
}) {
  return (
    <span className={`ql-input-check${checked ? " is-checked" : ""}`}>
      <input {...rest} />
      <button
        type="button"
        className="ql-check-btn"
        aria-pressed={!!checked}
        aria-label={checkLabel}
        title={checkLabel}
        onClick={onToggle}
      >
        <CheckIcon size={13} />
      </button>
    </span>
  );
}
