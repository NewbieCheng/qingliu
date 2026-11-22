import React, { useCallback, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { ChevronDownIcon } from "@/shared/ui/icons.jsx";

/**
 * 统一折叠条：标题左对齐；右侧动作与展开/收起同款描边小按钮 + SVG。
 *
 * `<details>` 没有 `defaultOpen` 这个 HTML 属性（React 也不认），
 * 传下去只会变成无意义的 DOM 属性并触发 no-unknown-property。
 * 初始展开只在首次挂载时写一次；之后交给浏览器，onToggle 只同步文案。
 *
 * 注意：不要在每次 ref 回调里重写 `node.open`——inline ref 每轮渲染都会
 * 换新函数，点开后 setState → 重渲染 → 又被重置成 defaultOpen，表现为闪现回弹。
 */
export function FoldPanel({
  title,
  badge = null,
  children,
  className = "",
  defaultOpen = false,
  // 折叠条右侧的自定义动作（例如「新增条目」）。
  // 放在标题行里而不是在内容顶部新起一行：能省一行高度，
  // 而且这些动作本来就属于这个区块，跟着标题走才对。
  actions = null,
}) {
  const { t } = useI18n();
  const detailsRef = useRef(null);
  const seededRef = useRef(false);
  const initialOpenRef = useRef(Boolean(defaultOpen));
  const [open, setOpen] = useState(initialOpenRef.current);

  const setDetailsRef = useCallback((node) => {
    detailsRef.current = node;
    if (!node || seededRef.current) return;
    node.open = initialOpenRef.current;
    seededRef.current = true;
  }, []);

  return (
    <details
      ref={setDetailsRef}
      className={`fold-panel${className ? ` ${className}` : ""}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="fold-panel-summary">
        <span className="fold-panel-title">
          {title}
          {badge}
        </span>
        {actions ? (
          <span
            className="fold-panel-actions"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            {actions}
          </span>
        ) : null}
        <span
          className={`fold-panel-toggle btn-outline btn-compact${open ? " is-open" : ""}`}
          aria-hidden="true"
        >
          <ChevronDownIcon size={12} />
          {open ? t("common.collapse") : t("common.expand")}
        </span>
      </summary>
      <div className="fold-panel-body">{children}</div>
    </details>
  );
}
