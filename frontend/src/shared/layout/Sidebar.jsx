import React from "react";
import { Link } from "@/shared/router/index.js";
import { NavIcon } from "@/shared/ui/icons.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { isQingliuAdmin } from "@/shared/lib/constants.js";
import { NAVIGATION, isNavItemActive } from "./navigation.js";

const TEAM_NAV_LOCKED =
  "个人空间不支持团队与权限管理。请开通团队版，或切换到团队空间后再使用。";

function NavItem({ item, pathname, collapsed, locked = false }) {
  const active = isNavItemActive(item, pathname);

  if (locked) {
    return (
      <button
        type="button"
        className={`rail-link is-locked ${active ? "active" : ""}`}
        title={collapsed ? TEAM_NAV_LOCKED : item.label}
        aria-disabled="true"
        onClick={() => toast(TEAM_NAV_LOCKED, "error")}
      >
        <NavIcon kind={item.icon} />
        <span className="rail-link-text">{item.label}</span>
      </button>
    );
  }

  return (
    <Link
      to={item.to}
      className={`rail-link ${active ? "active" : ""}`}
      title={collapsed ? item.label : undefined}
    >
      <NavIcon kind={item.icon} />
      <span className="rail-link-text">{item.label}</span>
    </Link>
  );
}

export function Sidebar({ user, pathname, collapsed, spaceSwitcher = null }) {
  const spaceKind = user?.kind || user?.space?.kind || "personal";
  const teamManaged = spaceKind === "team";

  return (
    <aside className="rail">
      <div className="rail-head">
        <Link to="/" className="brand" aria-label="青流工作台">
          <img
            className="brand-logo"
            src="/qingliu-logo-dark.svg"
            alt="青流"
          />
          <img
            className="brand-mark"
            src="/qingliu-icon-light.svg"
            alt="青流"
          />
        </Link>
      </div>
      <nav className="rail-nav" aria-label="主导航">
        {NAVIGATION.filter(
          (group) => !group.adminOnly || isQingliuAdmin(user),
        ).map((group) => (
          <div className="rail-group" key={group.label}>
            <p className="rail-group-label">{group.label}</p>
            {group.items.map((item) => (
              <NavItem
                key={item.to}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                locked={item.to === "/admin" && !teamManaged}
              />
            ))}
          </div>
        ))}
      </nav>
      <div className="rail-user">
        {spaceSwitcher ? spaceSwitcher(collapsed) : null}
      </div>
    </aside>
  );
}
