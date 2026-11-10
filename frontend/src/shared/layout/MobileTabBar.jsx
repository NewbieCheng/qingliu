import React, { useEffect, useId, useState } from "react";
import { Link } from "@/shared/router/index.js";
import { LockIcon, NavIcon } from "@/shared/ui/icons.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { isQingliuAdmin } from "@/shared/lib/constants.js";
import {
  MOBILE_PRIMARY_TABS,
  isMobileMeActive,
  isNavItemActive,
} from "./navigation.js";

const TEAM_NAV_LOCKED =
  "个人空间不支持团队与权限管理。请开通团队版，或切换到团队空间后再使用。";

/**
 * 手机端底部导航：客户 / 充值 / 我的。
 * 「我的」展开底部面板，收纳个人信息、空间切换、团队入口与退出。
 */
export function MobileTabBar({ user, pathname, onPassword, onLogout, spaceSwitcher = null }) {
  const sheetId = useId();
  const [meOpen, setMeOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const spaceKind = user?.kind || user?.space?.kind || "personal";
  const teamManaged = spaceKind === "team";
  const isAdmin = isQingliuAdmin(user);
  const meActive = isMobileMeActive(pathname);

  useEffect(() => {
    setMeOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!meOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMeOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [meOpen]);

  return (
    <>
      {meOpen ? (
        <button
          type="button"
          className="mobile-sheet-backdrop"
          aria-label="关闭我的面板"
          onClick={() => setMeOpen(false)}
        />
      ) : null}

      {meOpen ? (
        <section
          id={sheetId}
          className="mobile-me-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="我的"
        >
          <div className="mobile-me-handle" aria-hidden="true" />
          <header className="mobile-me-head">
            <div>
              <strong>{user?.display || "用户"}</strong>
              <p className="muted">{user?.email || "工作台账号"}</p>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => setMeOpen(false)}
            >
              关闭
            </button>
          </header>

          <div className="mobile-me-space">
            {spaceSwitcher ? spaceSwitcher(false) : null}
          </div>

          <nav className="mobile-me-nav" aria-label="我的菜单">
            <Link
              to="/profile"
              className={`mobile-me-link${pathname === "/profile" ? " active" : ""}`}
              onClick={() => setMeOpen(false)}
            >
              <NavIcon kind="user" size={18} />
              <span>个人信息</span>
            </Link>
            {isAdmin ? (
              teamManaged ? (
                <Link
                  to="/admin"
                  className={`mobile-me-link${
                    pathname === "/admin" || pathname.startsWith("/admin/")
                      ? " active"
                      : ""
                  }`}
                  onClick={() => setMeOpen(false)}
                >
                  <NavIcon kind="admin" size={18} />
                  <span>团队与权限</span>
                </Link>
              ) : (
                <button
                  type="button"
                  className="mobile-me-link is-locked"
                  onClick={() => toast(TEAM_NAV_LOCKED, "error")}
                >
                  <NavIcon kind="admin" size={18} />
                  <span>团队与权限</span>
                </button>
              )
            ) : null}
            <button
              type="button"
              className="mobile-me-link"
              onClick={() => {
                setMeOpen(false);
                onPassword?.();
              }}
            >
              <LockIcon size={18} />
              <span>修改密码</span>
            </button>
            <button
              type="button"
              className="mobile-me-link is-danger"
              onClick={() => {
                setMeOpen(false);
                setLogoutOpen(true);
              }}
            >
              <span>退出登录</span>
            </button>
          </nav>
        </section>
      ) : null}

      {logoutOpen ? (
        <Modal title="退出登录" className="modal--sm" onClose={() => setLogoutOpen(false)}>
          <p className="account-dialog-lead">
            退出后需要重新登录才能继续使用青流。当前设备上的会话会被结束，不影响其他设备。
          </p>
          <div className="account-dialog-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setLogoutOpen(false)}
              disabled={logoutBusy}
            >
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={logoutBusy}
              onClick={async () => {
                if (logoutBusy) return;
                setLogoutBusy(true);
                try {
                  await onLogout?.();
                } finally {
                  setLogoutBusy(false);
                  setLogoutOpen(false);
                }
              }}
            >
              {logoutBusy ? "正在退出…" : "确认退出"}
            </button>
          </div>
        </Modal>
      ) : null}

      <nav className="mobile-tabbar" aria-label="手机主导航">
        {MOBILE_PRIMARY_TABS.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`mobile-tab${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <NavIcon kind={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`mobile-tab${meActive || meOpen ? " active" : ""}`}
          aria-expanded={meOpen}
          aria-controls={sheetId}
          onClick={() => setMeOpen((value) => !value)}
        >
          <NavIcon kind="user" size={20} />
          <span>我的</span>
        </button>
      </nav>
    </>
  );
}
