import { useEffect, useRef } from "react";

/**
 * 统一任务轮询：busy 时只打轻量 tick，不靠整包 case 风暴。
 */
export function useJobPoll({ enabled, intervalMs = 3000, tick, isTerminal }) {
  const tickRef = useRef(tick);
  const terminalRef = useRef(isTerminal);
  tickRef.current = tick;
  terminalRef.current = isTerminal;

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let timer;

    const loop = async () => {
      if (!alive) return;
      try {
        const state = await tickRef.current?.();
        if (!alive) return;
        if (terminalRef.current?.(state)) return;
      } catch {
        // 单次失败不中断轮询；下一轮再试
      }
      if (!alive) return;
      timer = window.setTimeout(loop, intervalMs);
    };

    void loop();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}
