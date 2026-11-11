import React, { useEffect, useId, useState } from "react";
import { Link } from "@/shared/router/index.js";
import { LockIcon, NavIcon } from "@/shared/ui/icons.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { isQingliuAdmin } from "@/shared/lib/constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import {
  MOBILE_PRIMARY_TABS,
  isMobileMeActive,
  isNavItemActive,
} from "./navigation.js";

export function MobileTabBar({ user, pathname, onPassword, onLogout, spaceSwitcher = null }) {
  const { t } = useI18n();
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
          aria-label={t("mobile.close_me")}
          onClick={() => setMeOpen(false)}
        />
      ) : null}

      {meOpen ? (
        <section
          id={sheetId}
          className="mobile-me-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t("mobile.me_menu")}
        >
          <div className="mobile-me-handle" aria-hidden="true" />
          <header className="mobile-me-head">
            <div>
              <strong>{user?.display || t("space.user")}</strong>
              <p className="muted">{user?.email || t("space.account")}</p>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => setMeOpen(false)}
            >
              {t("common.close")}
            </button>
          </header>

          <div className="mobile-me-space">
            {spaceSwitcher ? spaceSwitcher(false) : null}
          </div>

          <nav className="mobile-me-nav" aria-label={t("mobile.me_menu")}>
            <Link
              to="/profile"
              className={`mobile-me-link${pathname === "/profile" ? " active" : ""}`}
              onClick={() => setMeOpen(false)}
            >
              <NavIcon kind="user" size={18} />
              <span>{t("nav.profile")}</span>
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
                  <span>{t("nav.admin")}</span>
                </Link>
              ) : (
                <button
                  type="button"
                  className="mobile-me-link is-locked"
                  onClick={() => toast(t("nav.team_locked"), "error")}
                >
                  <NavIcon kind="admin" size={18} />
                  <span>{t("nav.admin")}</span>
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
              <span>{t("profile.change_password")}</span>
            </button>
            <button
              type="button"
              className="mobile-me-link is-danger"
              onClick={() => {
                setMeOpen(false);
                setLogoutOpen(true);
              }}
            >
              <span>{t("auth.sign_out")}</span>
            </button>
          </nav>
        </section>
      ) : null}

      {logoutOpen ? (
        <Modal title={t("auth.sign_out_title")} className="modal--sm" onClose={() => setLogoutOpen(false)}>
          <p className="account-dialog-lead">{t("auth.sign_out_description")}</p>
          <div className="account-dialog-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setLogoutOpen(false)}
              disabled={logoutBusy}
            >
              {t("common.cancel")}
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
              {logoutBusy ? t("auth.signing_out") : t("auth.confirm_sign_out")}
            </button>
          </div>
        </Modal>
      ) : null}

      <nav className="mobile-tabbar" aria-label={t("mobile.primary_navigation")}>
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
              <span>{t(item.to === "/recharge" ? "nav.recharge" : "nav.clients")}</span>
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
          <span>{t("nav.mobile.me")}</span>
        </button>
      </nav>
    </>
  );
}
