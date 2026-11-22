import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./split-dock.css";

// 右侧停靠栏 + 可拖拽分隔条。
//
// 为什么不是浮窗：浮窗要用户自己拖开、还会挡住下面的内容，核对场景里
// "一边看表格一边看原件"必须两块同时完整可见。停靠 + 让位 + 可调宽度
// 才能同时满足：不遮挡、可自己决定给原件多少空间。
//
// 两种形态：
//   fixed    portal 到 body，贴视口顶+右（与顶栏同高齐顶）；主内容靠 --dock-inset 让位
//   inline   贴在父容器右侧（解析详情这类弹窗内部，弹窗本身是居中的）

const MIN_W = 360;
const STORE_KEY = "ql.dock.width";
const DEFAULT_W = 620;

function clampWidth(w, max) {
  return Math.min(Math.max(w, MIN_W), Math.max(MIN_W, max));
}

function readStoredWidth() {
  try {
    const v = Number(localStorage.getItem(STORE_KEY));
    if (Number.isFinite(v) && v >= MIN_W) return v;
  } catch {
    /* 隐私模式下读不到就用默认值 */
  }
  return DEFAULT_W;
}

export function SplitDock({
  variant = "fixed",
  title,
  subtitle,
  toolbar,
  onClose,
  children,
}) {
  // inline 形态的可用宽度由父容器决定（弹窗内是弹窗宽度），
  // 用固定 px 会在窄容器里把翻页按钮挤出边界，所以这里记比例。
  const [width, setWidth] = useState(() =>
    variant === "fixed" ? readStoredWidth() : 0,
  );
  const dragging = useRef(false);
  const paneRef = useRef(null);
  // inline 需要量父容器宽度；fixed portal 后父节点是 body，另存挂载点。
  const hostRef = useRef(null);

  const availWidth = useCallback(() => {
    if (variant === "fixed") return window.innerWidth;
    const parent = hostRef.current?.parentElement || paneRef.current?.parentElement;
    return parent ? parent.getBoundingClientRect().width : window.innerWidth;
  }, [variant]);

  const maxWidth = useCallback(() => Math.round(availWidth() * 0.66), [availWidth]);

  // inline 首次挂载时按父容器 46% 定宽，并夹在 [320, 66%] 内。
  useEffect(() => {
    if (variant !== "inline") return;
    const avail = availWidth();
    setWidth(clampWidth(Math.round(avail * 0.46), Math.round(avail * 0.66)));
  }, [variant, availWidth]);

  // 宽度变化时同步给页面：fixed 形态用 CSS 变量让主内容让位，
  // inline 形态由父容器自己用 flex 分配，不需要变量。
  useEffect(() => {
    if (variant !== "fixed") return undefined;
    const root = document.documentElement;
    root.style.setProperty("--dock-inset", `${width}px`);
    root.classList.add("has-dock-pane");
    // 对照一开就自动收起左侧导航：宽度本来就紧张，别忘了这是"看原件"，
    // 导航这时候没有用。用事件而不是直接改 DOM，收起状态仍归 WorkspaceShell 管。
    window.dispatchEvent(new CustomEvent("ql:rail-autocollapse"));
    return () => {
      root.style.setProperty("--dock-inset", "0px");
      root.classList.remove("has-dock-pane");
    };
  }, [width, variant]);

  // 窗口变窄时把越界的宽度收回来，避免页面被挤到不能看。
  useEffect(() => {
    function onResize() {
      setWidth((w) => clampWidth(w, maxWidth()));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [maxWidth]);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.classList.add("dock-resizing");
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return;
      // 宽度 = 面板右边缘到指针的距离。两种形态都成立：
      // fixed 的右边缘就是视口右边，inline 的右边缘是父容器右边。
      const rect = paneRef.current?.getBoundingClientRect();
      const right = rect ? rect.right : window.innerWidth;
      const next = clampWidth(right - e.clientX, maxWidth());
      setWidth(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.classList.remove("dock-resizing");
      setWidth((w) => {
        try {
          localStorage.setItem(STORE_KEY, String(w));
        } catch {
          /* 存不了就算了，下次用默认宽度 */
        }
        return w;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [maxWidth]);

  // 双击分隔条回到默认宽度，比反复拖拽省事。
  function resetWidth() {
    const avail = availWidth();
    const next = variant === "inline" ? Math.round(avail * 0.46) : DEFAULT_W;
    setWidth(clampWidth(next, maxWidth()));
  }

  const pane = (
    <aside
      ref={paneRef}
      className={`dock-pane dock-pane-${variant}`}
      style={{ width: `${width}px` }}
      aria-label={title}
    >
      <div
        className="dock-handle"
        onPointerDown={onPointerDown}
        onDoubleClick={resetWidth}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整原件面板宽度，双击恢复默认"
        tabIndex={0}
        onKeyDown={(e) => {
          // 键盘也能调，别把可访问性漏掉
          if (e.key === "ArrowLeft") setWidth((w) => clampWidth(w + 24, maxWidth()));
          if (e.key === "ArrowRight") setWidth((w) => clampWidth(w - 24, maxWidth()));
        }}
      >
        <span className="dock-grip" aria-hidden="true" />
      </div>

      <header className="dock-head" title={subtitle || undefined}>
        <strong className="dock-title">{title}</strong>
        <div className="dock-actions">
          {toolbar}
          <button type="button" className="btn-outline btn-compact" onClick={onClose}>
            收起
          </button>
        </div>
      </header>

      <div className="dock-body">{children}</div>
    </aside>
  );

  // fixed：挂到 body，避开页面祖先 transform/overflow 把 fixed 困在内容区
  // （困住后会从顶栏下方起算，右侧顶出一条空白缝）。
  if (variant === "fixed" && typeof document !== "undefined") {
    return createPortal(pane, document.body);
  }

  return (
    <div ref={hostRef} className="dock-inline-host">
      {pane}
    </div>
  );
}
