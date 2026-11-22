import React, { forwardRef, useCallback } from "react";
import "./scroll-region.css";

/**
 * 分区滚动容器：滚轮只作用在本区，滚到顶/底也不串到外层。
 *
 * 用于弹窗左右分栏、嵌套列表等「各滚各的」场景。
 * overscroll-behavior 管现代浏览器；onWheel 补一层边缘拦截，避免父级跟着滑。
 */
export const ScrollRegion = forwardRef(function ScrollRegion(
  {
    as: Tag = "div",
    className = "",
    children,
    axis = "y",
    /** 边缘仍有余量时是否允许事件冒泡（默认否：彻底隔离） */
    allowChain = false,
    ...rest
  },
  ref,
) {
  const onWheel = useCallback(
    (event) => {
      if (allowChain) return;
      const node = event.currentTarget;
      const {
        scrollTop,
        scrollHeight,
        clientHeight,
        scrollLeft,
        scrollWidth,
        clientWidth,
      } = node;
      const dx = event.deltaX;
      const dy = event.deltaY;

      const lockEdge = (atStart, atEnd, delta) => {
        if (delta === 0) return;
        // 本区无溢出时不要 preventDefault，否则滚轮被掐死、内容又滚不动
        if (atStart && atEnd) return;
        if ((!atStart && delta < 0) || (!atEnd && delta > 0)) {
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      };

      const preferX =
        axis === "x" ||
        (axis === "both" && Math.abs(dx) > Math.abs(dy));

      if (preferX) {
        // 仅横向区：无 deltaX 时，Shift+滚轮当作横向；纯竖滚放行给父级
        const effectiveDx =
          dx !== 0 ? dx : axis === "x" && event.shiftKey ? dy : 0;
        if (axis === "x" && effectiveDx === 0) return;
        lockEdge(
          scrollLeft <= 0,
          scrollLeft + clientWidth >= scrollWidth - 1,
          effectiveDx,
        );
        return;
      }

      if (axis === "x") return;
      lockEdge(
        scrollTop <= 0,
        scrollTop + clientHeight >= scrollHeight - 1,
        dy,
      );
    },
    [allowChain, axis],
  );

  return (
    <Tag
      ref={ref}
      className={`ql-scroll-region ql-scroll-region--${axis}${className ? ` ${className}` : ""}`}
      onWheel={onWheel}
      {...rest}
    >
      {children}
    </Tag>
  );
});
