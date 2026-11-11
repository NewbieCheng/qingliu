import React, { useEffect, useState } from "react";
import { useStoredFlag } from "@/shared/hooks/useStoredFlag.js";
import { Sidebar } from "./Sidebar.jsx";
import { Topbar } from "./Topbar.jsx";
import { MobileTabBar } from "./MobileTabBar.jsx";

const RAIL_KEY = "ql.rail.collapsed";
const TOPBAR_KEY = "ql.topbar.collapsed";
const NARROW_QUERY = "(max-width: 1000px)";
const PHONE_QUERY = "(max-width: 680px)";

/**
 * 窄屏（≤1000px）自动收侧栏；宽屏恢复用户记忆的展开/收起。
 * 手机（≤680px）隐藏侧栏，改用底部 Tab，不再走顶部横条挤压。
 */
export function WorkspaceShell({
  user,
  pathname,
  title,
  back,
  onPassword,
  onLogout,
  spaceSwitcher = null,
  children,
}) {
  const [railCollapsed, setRailCollapsed] = useStoredFlag(RAIL_KEY);
  const [topbarCollapsed, setTopbarCollapsed] = useStoredFlag(TOPBAR_KEY);
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(NARROW_QUERY).matches
      : false,
  );
  const [phone, setPhone] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(PHONE_QUERY).matches
      : false,
  );
  const [forceExpand, setForceExpand] = useState(false);

  useEffect(() => {
    const narrowMedia = window.matchMedia(NARROW_QUERY);
    const phoneMedia = window.matchMedia(PHONE_QUERY);

    function syncNarrow(event) {
      const matches = event?.matches ?? narrowMedia.matches;
      setNarrow(matches);
      if (!matches) setForceExpand(false);
    }

    function syncPhone(event) {
      setPhone(event?.matches ?? phoneMedia.matches);
    }

    syncNarrow();
    syncPhone();
    narrowMedia.addEventListener("change", syncNarrow);
    phoneMedia.addEventListener("change", syncPhone);
    return () => {
      narrowMedia.removeEventListener("change", syncNarrow);
      phoneMedia.removeEventListener("change", syncPhone);
    };
  }, []);

  const effectiveCollapsed = phone ? true : narrow ? !forceExpand : railCollapsed;

  function toggleRail() {
    if (phone) return;
    if (narrow) {
      setForceExpand((value) => !value);
      return;
    }
    setRailCollapsed((value) => !value);
  }

  return (
    <div
      className={`workspace ${effectiveCollapsed ? "rail-collapsed" : ""} ${
        topbarCollapsed ? "topbar-collapsed" : ""
      }${phone ? " is-phone" : ""}`}
    >
      {!phone ? (
        <Sidebar
          user={user}
          pathname={pathname}
          collapsed={effectiveCollapsed}
          spaceSwitcher={spaceSwitcher}
        />
      ) : null}
      <div className="main">
        <Topbar
          collapsed={topbarCollapsed}
          onToggle={() => setTopbarCollapsed((value) => !value)}
          railCollapsed={effectiveCollapsed}
          onToggleRail={toggleRail}
          hideRailToggle={phone}
          title={title}
          back={back}
        />
        <div className="page-wrap">{children}</div>
        <footer>
          For internal screening only. Lenient figures are not bank-approved revenue; final decisions follow verified files and bank review.
        </footer>
      </div>
      {phone ? (
        <MobileTabBar
          user={user}
          pathname={pathname}
          onPassword={onPassword}
          onLogout={onLogout}
          spaceSwitcher={spaceSwitcher}
        />
      ) : null}
    </div>
  );
}
