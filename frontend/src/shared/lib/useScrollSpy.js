import { useEffect, useRef } from "react";

// 滚动跟随：列表滚到哪一行，就回调哪一行。
//
// 为什么用 IntersectionObserver 而不是 scroll + getBoundingClientRect：
// 300 行每帧各读一次 rect 会强制同步布局（forced reflow），滚动直接掉帧。
// IntersectionObserver 的回调由浏览器在布局完成后批量给出，天然不抖动。
//
// rootMargin 把观察区收成"容器顶部的一条窄带"：只有刚进入顶部附近的行才算
// 当前行，否则一屏内所有行都算可见，取哪个都不对。
//
// enabled=false 时完全不监听——面板没打开时跟随没有意义，白耗性能。

export function useScrollSpy({ enabled, rootRef, selector, onActive }) {
  const lastId = useRef(null);
  const cbRef = useRef(onActive);
  cbRef.current = onActive;

  useEffect(() => {
    if (!enabled) return undefined;
    const root = rootRef?.current || null;
    // root 为 null 表示跟随视口滚动（核对页的长表格就是页面级滚动）
    const scope = root || document.body;
    if (!scope) return undefined;

    const visible = new Map();

    // 顶部留出吸顶栏的高度，底部收掉 70%，只留一条"行首带"
    const topInset = root ? 0 : 64;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target, e.boundingClientRect.top);
          else visible.delete(e.target);
        }
        let best = null;
        let bestTop = Infinity;
        for (const [el, top] of visible) {
          if (top < bestTop) {
            bestTop = top;
            best = el;
          }
        }
        const id = best?.dataset?.rowId;
        if (!id || id === lastId.current) return;
        lastId.current = id;
        cbRef.current?.(id);
      },
      {
        root,
        threshold: 0,
        rootMargin: `-${topInset}px 0px -70% 0px`,
      },
    );

    const nodes = scope.querySelectorAll(selector);
    nodes.forEach((n) => io.observe(n));

    return () => {
      io.disconnect();
      visible.clear();
    };
    // rows 变化（翻页/筛选）需要重新观察
  }, [enabled, rootRef, selector, onActive]);
}
