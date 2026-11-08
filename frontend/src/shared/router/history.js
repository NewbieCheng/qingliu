import { useEffect, useState } from "react";

const NAV_EVENT = "ql:navigate";

function currentLocation() {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

export function navigate(to, { replace = false } = {}) {
  if (typeof to !== "string" || to === "") return;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (to === current) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function useLocation() {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const sync = () => setLocation(currentLocation());
    window.addEventListener("popstate", sync);
    window.addEventListener(NAV_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAV_EVENT, sync);
    };
  }, []);
  return location;
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  function setSearchParams(next, options = {}) {
    const value =
      next instanceof URLSearchParams
        ? next
        : new URLSearchParams(
            Object.entries(next).filter(([, item]) => item != null && item !== ""),
          );
    const query = value.toString();
    navigate(
      `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
      options,
    );
  }
  return [params, setSearchParams];
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
