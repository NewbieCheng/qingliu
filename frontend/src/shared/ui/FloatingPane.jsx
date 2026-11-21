import React, { useCallback, useEffect, useRef, useState } from "react";
import "./floating-pane.css";

// 可拖拽 / 可缩放的浮窗。
//
// 为什么不用 <dialog> 或 modal：这些面板的用途是"一边看左边的内容一边瞄右边"，
// 模态会挡住下面的表格，用户还得来回关。浮窗能挪开、能缩，才能真正常驻。
//
// 交互约定：
//   - 拖标题栏移动；拖右下角改大小
//   - 位置与尺寸始终夹在视口内，绝不跑到屏幕外找不回来
//   - 标题栏按钮不做拖拽（pointerdown 时判来源）
//   - 记住上次的尺寸（换页/换行不重置，避免每次都要重新拉大）

const MIN_W = 320;
const MIN_H = 260;
const EDGE = 8;

function clamp(v, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(v, min), max);
}

// 默认落在右侧：不压住左侧主要内容，又不需要用户先拖一次才能看。
function defaultPosition(w, h) {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const width = Math.min(w, Math.max(MIN_W, vw - 2 * EDGE));
  const height = Math.min(h, Math.max(MIN_H, vh - 2 * EDGE));
  return {
    x: clamp(vw - width - EDGE - 12, EDGE, vw - width - EDGE),
    y: clamp(Math.round((vh - height) / 2), EDGE, vh - height - EDGE),
    w: width,
    h: height,
  };
}

export function FloatingPane({
  title,
  subtitle,
  toolbar,
  onClose,
  children,
  defaultWidth = 560,
  defaultHeight = 660,
  ariaLabel,
}) {
  const [box, setBox] = useState(() => defaultPosition(defaultWidth, defaultHeight));
  const dragRef = useRef(null);
  const paneRef = useRef(null);

  // 视口变化时把浮窗拉回可视区，避免缩小窗口后浮窗"消失"在屏幕外。
  useEffect(() => {
    function onResize() {
      setBox((b) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = Math.min(b.w, Math.max(MIN_W, vw - 2 * EDGE));
        const h = Math.min(b.h, Math.max(MIN_H, vh - 2 * EDGE));
        return {
          w,
          h,
          x: clamp(b.x, EDGE, vw - w - EDGE),
          y: clamp(b.y, EDGE, vh - h - EDGE),
        };
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 内容让位：浮窗贴住右边缘时，把主内容区右侧留出等宽空白，
  // 这样浮窗不压住页面内容；用户把浮窗拖走后就恢复满宽。
  // 用 CSS 变量而不是直接改 DOM 宽度，页面只需读变量即可。
  useEffect(() => {
    const vw = window.innerWidth;
    const docked = box.x + box.w >= vw - 48;
    const inset = docked ? Math.max(0, Math.round(vw - box.x) + 8) : 0;
    document.documentElement.style.setProperty("--floating-pane-inset-right", `${inset}px`);
    document.documentElement.classList.toggle("has-floating-pane", inset > 0);
    return () => {
      document.documentElement.style.setProperty("--floating-pane-inset-right", "0px");
      document.documentElement.classList.remove("has-floating-pane");
    };
  }, [box.x, box.w]);

  // 统一用 pointer 事件：鼠标、触控笔、触摸屏一套代码。
  const startDrag = useCallback((kind, event) => {
    // 标题栏上的按钮点击不应该开始拖拽
    if (event.target.closest("button, input, select, a")) return;
    event.preventDefault();
    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...box },
      rect,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [box]);

  useEffect(() => {
    function onMove(event) {
      const d = dragRef.current;
      if (!d) return;
      const dx = event.clientX - d.startX;
      const dy = event.clientY - d.startY;
      if (d.kind === "move") {
        setBox({
          ...d.origin,
          x: clamp(d.origin.x + dx, EDGE, window.innerWidth - d.origin.w - EDGE),
          y: clamp(d.origin.y + dy, EDGE, window.innerHeight - d.origin.h - EDGE),
        });
      } else {
        setBox({
          ...d.origin,
          w: clamp(d.origin.w + dx, MIN_W, window.innerWidth - d.origin.x - EDGE),
          h: clamp(d.origin.h + dy, MIN_H, window.innerHeight - d.origin.y - EDGE),
        });
      }
    }
    function onUp() {
      dragRef.current = null;
      document.body.classList.remove("floating-pane-dragging");
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    if (dragRef.current) document.body.classList.add("floating-pane-dragging");
  });

  return (
    <div
      ref={paneRef}
      className="floating-pane"
      role="dialog"
      aria-label={ariaLabel || title}
      style={{
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.w}px`,
        height: `${box.h}px`,
      }}
    >
      <header
        className="floating-pane-head"
        onPointerDown={(e) => startDrag("move", e)}
        title="拖动可移动窗口"
      >
        <div className="floating-pane-title">
          <strong>{title}</strong>
          {subtitle ? <span className="floating-pane-sub">{subtitle}</span> : null}
        </div>
        <div className="floating-pane-head-actions">
          {toolbar}
          {onClose ? (
            <button type="button" className="btn-outline btn-compact" onClick={onClose}>
              收起
            </button>
          ) : null}
        </div>
      </header>

      <div className="floating-pane-body">{children}</div>

      <div
        className="floating-pane-resize"
        onPointerDown={(e) => startDrag("resize", e)}
        role="separator"
        aria-label="调整窗口大小"
      />
    </div>
  );
}
