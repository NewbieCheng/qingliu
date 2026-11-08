import React from "react";
import { useStoredFlag } from "@/shared/hooks/useStoredFlag.js";
import { Sidebar } from "./Sidebar.jsx";
import { Topbar } from "./Topbar.jsx";

const RAIL_KEY = "ql.rail.collapsed";
const TOPBAR_KEY = "ql.topbar.collapsed";

export function WorkspaceShell({ user, pathname, onPassword, onLogout, children }) {
  const [railCollapsed, setRailCollapsed] = useStoredFlag(RAIL_KEY);
  const [topbarCollapsed, setTopbarCollapsed] = useStoredFlag(TOPBAR_KEY);

  return (
    <div
      className={`workspace ${railCollapsed ? "rail-collapsed" : ""} ${
        topbarCollapsed ? "topbar-collapsed" : ""
      }`}
    >
      <Sidebar
        user={user}
        pathname={pathname}
        collapsed={railCollapsed}
        onToggle={() => setRailCollapsed((value) => !value)}
        onLogout={onLogout}
        onPassword={onPassword}
      />
      <div className="main">
        <Topbar
          collapsed={topbarCollapsed}
          onToggle={() => setTopbarCollapsed((value) => !value)}
        />
        <div className="page-wrap">{children}</div>
        <footer>
          仅供内部初筛参考，宽松测算不等于银行认可营业收入；最终以核实资料和银行审核为准。
        </footer>
      </div>
    </div>
  );
}
