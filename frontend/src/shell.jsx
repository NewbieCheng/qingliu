import React, { useEffect, useState } from "react";
import { Link, navigate } from "./router.jsx";

const RAIL_KEY = "ql.rail.collapsed";
const TOPBAR_KEY = "ql.topbar.collapsed";
const ROLE_LABEL = { admin: "管理员", sales: "业务员", reviewer: "复核员" };

function useStoredFlag(key) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, [key, value]);
  return [value, setValue];
}

function NavIcon({ kind }) {
  const paths = {
    clients: (
      <>
        <path d="M3.5 6.5h6l1.6 2H20.5v9.5a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 18V8a1.5 1.5 0 0 1 .5-1.5Z" />
        <path d="M3.5 9h17" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 9h18M16 13.5h2.5" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" />
      </>
    ),
    admin: (
      <>
        <path d="M12 3 20 6v6.2c0 4.6-2.7 7.5-8 9.1-5.3-1.6-8-4.5-8-9.1V6l8-3Z" />
        <path d="M9 12.2l2 2 4-4.2" />
      </>
    ),
  };
  return (
    <svg
      className="rail-link-icon"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

function NavItem({ to, pathname, children, collapsed, icon }) {
  const active =
    to === "/"
      ? pathname === "/"
      : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link
      to={to}
      className={`rail-link ${active ? "active" : ""}`}
      title={collapsed ? children : undefined}
    >
      <NavIcon kind={icon} />
      <span className="rail-link-text">{children}</span>
    </Link>
  );
}

export function WorkspaceShell({
  user,
  pathname,
  onPassword,
  onLogout,
  children,
}) {
  const [railCollapsed, setRailCollapsed] = useStoredFlag(RAIL_KEY);
  const [topbarCollapsed, setTopbarCollapsed] = useStoredFlag(TOPBAR_KEY);
  const initials = (user.display || "清").slice(0, 1);

  return (
    <div
      className={`workspace ${railCollapsed ? "rail-collapsed" : ""} ${
        topbarCollapsed ? "topbar-collapsed" : ""
      }`}
    >
      <aside className="rail">
        <div className="rail-head">
          <Link to="/" className="brand">
            <span className="brand-name">清流</span>
            <span className="brand-note">资料有据 · 测算有序</span>
          </Link>
          <button
            type="button"
            className="rail-toggle"
            aria-label={railCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!railCollapsed}
            onClick={() => setRailCollapsed((value) => !value)}
          >
            {railCollapsed ? "›" : "‹"}
          </button>
        </div>
        <nav className="rail-nav" aria-label="主导航">
          <div className="rail-group">
            <p className="rail-group-label">工作区</p>
            <NavItem
              to="/"
              pathname={pathname}
              collapsed={railCollapsed}
              icon="clients"
            >
              客户档案
            </NavItem>
          </div>
          <div className="rail-group">
            <p className="rail-group-label">账户</p>
            <NavItem
              to="/recharge"
              pathname={pathname}
              collapsed={railCollapsed}
              icon="wallet"
            >
              充值
            </NavItem>
            <NavItem
              to="/profile"
              pathname={pathname}
              collapsed={railCollapsed}
              icon="user"
            >
              个人信息
            </NavItem>
          </div>
          {user.role === "admin" && (
            <div className="rail-group">
              <p className="rail-group-label">管理</p>
              <NavItem
                to="/admin"
                pathname={pathname}
                collapsed={railCollapsed}
                icon="admin"
              >
                团队与权限
              </NavItem>
            </div>
          )}
        </nav>
        <div className="rail-user">
          <div className="rail-avatar" aria-hidden="true">
            {initials}
          </div>
          <div className="rail-user-copy">
            <strong>{user.display}</strong>
            <span>{user.email || ROLE_LABEL[user.role] || "工作台账号"}</span>
          </div>
          <div className="rail-user-actions">
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

      <div className="main">
        <header className="topbar">
          <div className="topbar-copy">
            <button
              type="button"
              className="topbar-toggle"
              aria-label={topbarCollapsed ? "展开顶栏" : "收起顶栏"}
              aria-expanded={!topbarCollapsed}
              onClick={() => setTopbarCollapsed((value) => !value)}
            >
              {topbarCollapsed ? "⌄" : "⌃"}
            </button>
            <span className="topbar-title">内部初筛工作台</span>
            {!topbarCollapsed && (
              <span className="topbar-note">
                原件留存 · 人工复核 · 版本留痕
              </span>
            )}
          </div>
          <div className="topbar-links">
            <Link to="/recharge">账户</Link>
            <button
              type="button"
              className="ghost topbar-logout"
              onClick={() => {
                onLogout();
                navigate("/login");
              }}
            >
              退出
            </button>
          </div>
        </header>
        <div className="page-wrap">{children}</div>
        <footer>
          仅供内部初筛参考，宽松测算不等于银行认可营业收入；最终以核实资料和银行审核为准。
        </footer>
      </div>
    </div>
  );
}
