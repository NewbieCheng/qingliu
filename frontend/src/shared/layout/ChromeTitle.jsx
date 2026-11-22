import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const ChromeTitleContext = createContext(null);

/**
 * 顶栏标题 + 配件挂载点：
 * App 传入路由默认标题；页面可覆盖标题，或把控件 portal 到标题旁 / 顶栏正中。
 */
export function ChromeTitleProvider({ defaultTitle = "", children }) {
  const [override, setOverride] = useState(null);
  const accessoryHostRef = useRef(null);
  const centerHostRef = useRef(null);
  const [, bump] = useState(0);
  const value = useMemo(
    () => ({
      title: override ?? defaultTitle,
      setTitle: setOverride,
      clearTitle: () => setOverride(null),
      accessoryHostRef,
      centerHostRef,
      notifyAccessoryHost: () => bump((n) => n + 1),
    }),
    [defaultTitle, override],
  );

  useEffect(() => {
    setOverride(null);
  }, [defaultTitle]);

  return (
    <ChromeTitleContext.Provider value={value}>
      {children}
    </ChromeTitleContext.Provider>
  );
}

export function useChromeTitle() {
  const ctx = useContext(ChromeTitleContext);
  if (!ctx) {
    throw new Error("useChromeTitle must be used within ChromeTitleProvider");
  }
  return ctx;
}

/** 挂载期间把顶栏标题设为 value；卸载恢复默认。 */
export function useChromeTitleValue(value) {
  const { setTitle, clearTitle } = useChromeTitle();
  useEffect(() => {
    const next = String(value || "").trim();
    if (!next) {
      clearTitle();
      return undefined;
    }
    setTitle(next);
    return () => clearTitle();
  }, [value, setTitle, clearTitle]);
}

/**
 * 把 children portal 到顶栏标题右侧。
 * 仅在个人页等需要时挂载；卸载即消失。
 */
export function ChromeAccessory({ children }) {
  const { accessoryHostRef, notifyAccessoryHost } = useChromeTitle();
  const [host, setHost] = useState(null);

  useLayoutEffect(() => {
    const node = accessoryHostRef.current;
    setHost(node);
    notifyAccessoryHost();
  }, [accessoryHostRef, notifyAccessoryHost]);

  if (!host) return null;
  return createPortal(children, host);
}

/** 把 children portal 到顶栏正中（核对筛选等）。 */
export function ChromeCenter({ children }) {
  const { centerHostRef, notifyAccessoryHost } = useChromeTitle();
  const [host, setHost] = useState(null);

  useLayoutEffect(() => {
    const node = centerHostRef.current;
    setHost(node);
    notifyAccessoryHost();
  }, [centerHostRef, notifyAccessoryHost]);

  if (!host) return null;
  return createPortal(children, host);
}
