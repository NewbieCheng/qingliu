import React, { useRef } from "react";

/**
 * 统一折叠条：标题左对齐，右侧「展开/收起」文字，无左侧箭头/SVG。
 *
 * `<details>` 没有 `defaultOpen` 这个 HTML 属性（React 也不认），
 * 传下去只会变成无意义的 DOM 属性并触发 no-unknown-property。
 * 初始展开状态改用 ref 在挂载时设 `open`，之后交给浏览器自己管，
 * 不受控也不抢用户的点击。
 */
export function FoldPanel({
  title,
  badge = null,
  children,
  className = "",
  defaultOpen = false,
}) {
  const ref = useRef(null);

  function syncOpen(node) {
    ref.current = node;
    if (node && defaultOpen) node.open = true;
  }

  return (
    <details
      ref={syncOpen}
      className={`fold-panel${className ? ` ${className}` : ""}`}
    >
      <summary className="fold-panel-summary">
        <span className="fold-panel-title">
          {title}
          {badge}
        </span>
        <span className="fold-panel-toggle" aria-hidden="true" />
      </summary>
      <div className="fold-panel-body">{children}</div>
    </details>
  );
}
