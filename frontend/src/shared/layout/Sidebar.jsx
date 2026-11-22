import React from "react";
import { Link } from "@/shared/router/index.js";
import { NavIcon, RailToggleIcon } from "@/shared/ui/icons.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { isQingliuAdmin } from "@/shared/lib/constants.js";
import { NAVIGATION, isNavItemActive } from "./navigation.js";
import { useI18n } from "@/shared/i18n/index.jsx";

const TEAM_NAV_LOCKED = "nav.team_locked";

function NavItem({ item, pathname, collapsed, locked = false, label, t }) {
  const active = isNavItemActive(item, pathname);

  if (locked) {
    return (
      <button
        type="button"
        className={`rail-link is-locked ${active ? "active" : ""}`}
        title={collapsed ? t(TEAM_NAV_LOCKED) : label}
        aria-disabled="true"
        onClick={() => toast(t(TEAM_NAV_LOCKED), "error")}
      >
        <NavIcon kind={item.icon} />
        <span className="rail-link-text">{label}</span>
      </button>
    );
  }

  return (
    <Link
      to={item.to}
      className={`rail-link ${active ? "active" : ""}`}
      title={collapsed ? label : undefined}
    >
      <NavIcon kind={item.icon} />
      <span className="rail-link-text">{label}</span>
    </Link>
  );
}

export function Sidebar({
  user,
  pathname,
  collapsed,
  onToggleRail = null,
  spaceSwitcher = null,
}) {
  const { t } = useI18n();
  const spaceKind = user?.kind || user?.space?.kind || "personal";
  const teamManaged = spaceKind === "team";
  const navLabel = (item) => {
    const key = { "/": "nav.clients", "/recharge": "nav.recharge", "/profile": "nav.profile", "/admin": "nav.admin" }[item.to];
    return key ? t(key) : item.label;
  };
  const groupLabel = (label) => {
    const key = { Workspace: "nav.group.workspace", Account: "nav.group.account", Admin: "nav.group.admin" }[label];
    return key ? t(key) : label;
  };

  return (
    <aside className="rail">
      <div className="rail-head">
        <Link to="/" className="brand" aria-label={t("app.title_suffix")}>
          <img
            className="brand-mark"
            src="/qingliu-icon-light.svg"
            alt=""
          />
          <span className="brand-word">{t("brand.short")}</span>
        </Link>
        {!collapsed && onToggleRail ? (
          <button
            type="button"
            className="rail-toggle"
            aria-label={t("topbar.collapse_rail")}
            aria-expanded="true"
            title={t("topbar.collapse_rail")}
            onClick={onToggleRail}
          >
            <RailToggleIcon collapsed={false} />
          </button>
        ) : null}
      </div>
      <nav className="rail-nav" aria-label={t("nav.main")}>
        {NAVIGATION.filter(
          (group) => !group.adminOnly || isQingliuAdmin(user),
        ).map((group) => (
          <div className="rail-group" key={group.label}>
            <p className="rail-group-label">{groupLabel(group.label)}</p>
            {group.items.map((item) => (
              <NavItem
                key={item.to}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                locked={item.to === "/admin" && !teamManaged}
                label={navLabel(item)}
                t={t}
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
