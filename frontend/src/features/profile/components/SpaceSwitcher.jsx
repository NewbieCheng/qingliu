import React, { useCallback, useEffect, useId, useState } from "react";
import { toast } from "@/shared/ui/toast-api.js";
import { Modal } from "@/shared/ui/Modal.jsx";
import { BuildingIcon, CheckIcon, UserIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { invalidateAll, querySpaces } from "@/app/queries/index.js";
import { enableSpace, switchSpace } from "../api.js";
import { LogoutConfirmDialog } from "../LogoutConfirmDialog.jsx";

const SPACE_KIND = {
  personal: {
    label: "space.personal",
    short: "space.personal_short",
    hint: "space.personal_hint",
  },
  team: {
    label: "space.team",
    short: "space.team_short",
    hint: "space.team_hint",
  },
  platform: {
    label: "space.platform",
    short: "space.platform_short",
    hint: "space.platform_hint",
  },
};

function spaceTitle(item, t) {
  if (item?.name) return item.name;
  return t(SPACE_KIND[item?.kind]?.label || "space.generic");
}

function spaceDetail(item, t) {
  if (!item || item.kind === "personal") return t(SPACE_KIND.personal.hint);
  if (item.kind === "platform") return t(SPACE_KIND.platform.hint);
  const role = item.role_label || t("space.member");
  return `${role} · ${t(SPACE_KIND.team.hint)}`;
}

function SpaceGlyph({ kind }) {
  if (kind === "team") return <BuildingIcon size={15} />;
  return <UserIcon size={15} />;
}

/**
 * 侧栏底部空间入口。
 * - 展开：头像 + 姓名 + 当前空间
 * - 收栏：只留压缩头像按钮
 * - 点开一律走居中二级弹层（避免收栏时菜单被挤坏）
 */
export function SpaceSwitcher({ user, collapsed = false }) {
  const { t } = useI18n();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [warn, setWarn] = useState("");
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);

  const initials = (user?.display || t("space.user_initial")).slice(0, 1);
  const accountLine = user?.email || (user?.role ? t(`role.${user.role}`) : t("space.account"));

  const load = useCallback(async () => {
    try {
      const payload = await querySpaces();
      setItems(payload?.items ?? []);
      setWarn(payload?.warn ?? "");
    } catch (error) {
      setWarn(error.message || t("space.load_failed"));
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    void load();
  }, [open, load]);

  const current =
    items.find((item) => item.current) ||
    (user
      ? {
          kind: user.space?.kind || user.kind || "personal",
          id: user.space?.id || 0,
          name: user.space_name,
          role_label: user.role_label,
          current: true,
        }
      : null);

  const currentKind = current?.kind || "personal";
  const currentTitle = spaceTitle(current, t);
  const currentDetail = spaceDetail(current, t);

  async function onSwitch(item) {
    if (item.current || busy) return;
    const key = `switch:${item.kind}:${item.id}`;
    setBusy(key);
    try {
      await switchSpace(item.kind, item.id);
      invalidateAll();
      toast(t("space.switched"));
      window.location.reload();
    } catch (error) {
      toast(error.message, "error");
      setBusy("");
    }
  }

  async function onEnable(item) {
    if (busy) return;
    const key = `enable:${item.kind}:${item.id}`;
    setBusy(key);
    try {
      const payload = await enableSpace(item.kind, item.id);
      setItems(payload?.items ?? []);
      toast(t("space.enabled"));
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={`rail-space${collapsed ? " is-compact" : ""}${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="rail-space-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("space.open_switcher", { title: currentTitle })}
        title={`${currentTitle} · ${currentDetail}`}
        onClick={() => setOpen(true)}
      >
        <span className="rail-avatar" aria-hidden="true">
          {initials}
        </span>
        {!collapsed ? (
          <>
            <span className="rail-space-copy">
              <strong className="rail-space-user">{user?.display || t("space.user")}</strong>
              <span className="rail-space-now">
                <em>{t(SPACE_KIND[currentKind]?.short || "space.generic")}</em>
                {currentTitle}
              </span>
            </span>
            <span className="rail-space-chevron" aria-hidden="true">
              ▾
            </span>
          </>
        ) : (
          <span className="rail-space-compact-meta" aria-hidden="true">
            {t(SPACE_KIND[currentKind]?.short || "space.generic")}
          </span>
        )}
      </button>

      {open ? (
        <Modal
          title={t("space.switch_title")}
          className="modal--sm space-switch-sheet"
          onClose={() => setOpen(false)}
        >
          <p className="space-switch-account">{accountLine}</p>
          <p className="muted space-switch-hint">
            {t("space.current", {
              kind: t(SPACE_KIND[currentKind]?.short || "space.generic"),
              title: currentTitle,
            })}
          </p>
          <ul
            className="space-switch-list"
            role="listbox"
            id={listId}
            aria-label={t("space.available")}
          >
            {items.map((item) => {
              const key = `${item.kind}:${item.id}`;
              const selected = Boolean(item.current);
              const locked = item.status === "locked";
              const removed = item.status === "removed";
              const switching = busy === `switch:${key}`;
              const enabling = busy === `enable:${key}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`space-switch-option${selected ? " is-current" : ""}${
                      locked || removed ? " is-muted" : ""
                    }`}
                    disabled={selected || removed || Boolean(busy)}
                    onClick={() => {
                      if (locked) {
                        void onEnable(item);
                        return;
                      }
                      void onSwitch(item);
                    }}
                  >
                    <span className="space-switch-option-icon" aria-hidden="true">
                      <SpaceGlyph kind={item.kind} />
                    </span>
                    <span className="space-switch-option-copy">
                      <strong>{spaceTitle(item, t)}</strong>
                      <span>{spaceDetail(item, t)}</span>
                    </span>
                    <span className="space-switch-option-meta">
                      {selected ? (
                        <CheckIcon size={14} />
                      ) : removed ? (
                        t("space.removed")
                      ) : locked ? (
                        enabling ? t("space.enabling") : t("space.enable")
                      ) : switching ? (
                        t("space.switching")
                      ) : (
                        t(SPACE_KIND[item.kind]?.short || "space.generic")
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!loaded ? <p className="muted space-switch-warn">{t("space.loading")}</p> : null}
          {loaded && items.length === 0 ? (
            <p className="muted space-switch-warn">{warn || t("space.no_other")}</p>
          ) : null}
          {loaded && items.length > 0 && warn ? (
            <p className="muted space-switch-warn">{warn}</p>
          ) : null}
          <div className="space-switch-footer">
            <button
              type="button"
              className="space-switch-logout"
              onClick={() => {
                setOpen(false);
                setLogoutOpen(true);
              }}
            >
              {t("auth.sign_out")}
            </button>
          </div>
        </Modal>
      ) : null}
      {logoutOpen ? (
        <LogoutConfirmDialog
          onClose={() => {
            setLogoutOpen(false);
            setOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}
