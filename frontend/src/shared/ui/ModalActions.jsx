import React from "react";

/** 弹窗 / 卡片底栏：次操作在左，主操作靠右。 */
export function ModalActions({ children, className = "" }) {
  return (
    <div className={`modal-actions${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
