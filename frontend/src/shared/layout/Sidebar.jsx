import React from "react";
import { Link } from "@/shared/router/index.js";
import { ROLES } from "@/shared/lib/constants.js";
import { NavIcon, RailToggleIcon } from "@/shared/ui/icons.jsx";
import { NAVIGATION, isNavItemActive } from "./navigation.js";

function NavItem({ item, pathname, collapsed }) {
  const active = isNavItemActive(item, pathname);
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

export function Sidebar({
  user,
  pathname,
  collapsed,
  onToggle,
  onLogout,
  onPassword,
}) {
  const initials = (user.display || "清").slice(0, 1);

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
        <button
          type="button"
          className="topbar-sidebar"
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          onClick={onToggle}
        >
          <RailToggleIcon collapsed={collapsed} />
        </button>
      </div>
      <nav className="rail-nav" aria-label="主导航">
        {NAVIGATION.filter(
          (group) => !group.adminOnly || user.role === "admin",
        ).map((group) => (
          <div className="rail-group" key={group.label}>
            <p className="rail-group-label">{group.label}</p>
            {group.items.map((item) => (
              <NavItem
                key={item.to}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </nav>
      <div className="rail-user">
        <div className="rail-avatar" aria-hidden="true">
          {initials}
        </div>
        <div className="rail-user-copy">
          <strong>{user.display}</strong>
          <span>{user.email || ROLES[user.role] || "工作台账号"}</span>
        </div>
        <div className="rail-user-actions">
          <Link to="/recharge" className="rail-user-action">
            账户
          </Link>
          <button
            type="button"
            className="ghost rail-user-action"
            onClick={onLogout}
          >
            退出
          </button>
          <button
            type="button"
            className="ghost rail-user-action"
            onClick={onPassword}
          >
            修改密码
          </button>
        </div>
      </div>
    </aside>
  );
}
