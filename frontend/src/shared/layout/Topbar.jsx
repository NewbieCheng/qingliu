import React from "react";
import { TopbarToggleIcon } from "@/shared/ui/icons.jsx";

export function Topbar({ collapsed, onToggle }) {
  return (
    <header className="topbar">
      <div className="topbar-links">
        <button
          type="button"
          className="topbar-toggle"
          aria-label={collapsed ? "展开顶栏" : "收起顶栏"}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <TopbarToggleIcon collapsed={collapsed} />
        </button>
      </div>
    </header>
  );
}
