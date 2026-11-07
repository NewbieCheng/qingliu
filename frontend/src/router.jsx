import React, { useEffect, useState } from "react";

const NAV_EVENT = "ql:navigate";

export function navigate(to, { replace = false } = {}) {
  if (typeof to !== "string" || to === "") return;
  const current = `${location.pathname}${location.search}`;
  if (to === current) return;
  history[replace ? "replaceState" : "pushState"]({}, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function usePathname() {
  const [pathname, setPathname] = useState(location.pathname);
  useEffect(() => {
    const sync = () => setPathname(location.pathname);
    window.addEventListener("popstate", sync);
    window.addEventListener(NAV_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAV_EVENT, sync);
    };
  }, []);
  return pathname;
}

export function useLinkInterceptor() {
  useEffect(() => {
    const onClick = (event) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      const anchor = event.target.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (anchor.target || anchor.hasAttribute("download")) return;
      event.preventDefault();
      navigate(href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

export function Link({ to, children, className = "", onClick, ...rest }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
