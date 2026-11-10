import React, { useCallback, useEffect, useId, useState } from "react";
import { toast } from "@/shared/ui/toast-api.js";
import { Modal } from "@/shared/ui/Modal.jsx";
import { BuildingIcon, CheckIcon, UserIcon } from "@/shared/ui/icons.jsx";
import { ROLES } from "@/shared/lib/constants.js";
import { invalidateAll, querySpaces } from "@/app/queries/index.js";
import { enableSpace, switchSpace } from "../api.js";

const SPACE_KIND = {
  personal: {
    label: "个人空间",
    short: "个人",
    hint: "只看自己创建的资料，与团队完全隔离",
  },
  team: {
    label: "团队空间",
    short: "团队",
    hint: "查看并协作本团队全部资料",
  },
  platform: {
    label: "平台空间",
    short: "平台",
    hint: "平台视图在工作台，青流仅显示自己创建的",
  },
};

function spaceTitle(item) {
  if (item?.name) return item.name;
  return SPACE_KIND[item?.kind]?.label || "空间";
}

function spaceDetail(item) {
  if (!item) return SPACE_KIND.personal.hint;
  if (item.kind === "personal") return SPACE_KIND.personal.hint;
  if (item.kind === "platform") return SPACE_KIND.platform.hint;
  const role = item.role_label || "成员";
  return `${role} · ${SPACE_KIND.team.hint}`;
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
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [warn, setWarn] = useState("");
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);

  const initials = (user?.display || "清").slice(0, 1);
  const accountLine = user?.email || ROLES[user?.role] || "工作台账号";

  const load = useCallback(async () => {
    try {
      const payload = await querySpaces();
      setItems(payload?.items ?? []);
      setWarn(payload?.warn ?? "");
    } catch (error) {
      setWarn(error.message || "暂无多余空间");
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, []);

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
  const currentTitle = spaceTitle(current);
  const currentDetail = spaceDetail(current);

  async function onSwitch(item) {
    if (item.current || busy) return;
    const key = `switch:${item.kind}:${item.id}`;
    setBusy(key);
    try {
      await switchSpace(item.kind, item.id);
      invalidateAll();
      toast("已切换空间，正在刷新…");
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
      toast("空间已开启，可以切换了");
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
        title={`${currentTitle} · ${currentDetail}`}
        onClick={() => setOpen(true)}
      >
        <span className="rail-avatar" aria-hidden="true">
          {initials}
        </span>
        {!collapsed ? (
          <>
            <span className="rail-space-copy">
              <strong className="rail-space-user">{user?.display || "用户"}</strong>
              <span className="rail-space-now">
                <em>{SPACE_KIND[currentKind]?.short || "空间"}</em>
                {currentTitle}
              </span>
            </span>
            <span className="rail-space-chevron" aria-hidden="true">
              ▾
            </span>
          </>
        ) : (
          <span className="rail-space-compact-meta" aria-hidden="true">
            {SPACE_KIND[currentKind]?.short || "空间"}
          </span>
        )}
      </button>

      {open ? (
        <Modal
          title="切换工作空间"
          className="modal--sm space-switch-sheet"
          onClose={() => setOpen(false)}
        >
          <p className="space-switch-account">{accountLine}</p>
          <p className="muted space-switch-hint">
            当前：{SPACE_KIND[currentKind]?.short || "空间"} · {currentTitle}
          </p>
          <ul
            className="space-switch-list"
            role="listbox"
            id={listId}
            aria-label="可选空间"
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
                      <strong>{spaceTitle(item)}</strong>
                      <span>{spaceDetail(item)}</span>
                    </span>
                    <span className="space-switch-option-meta">
                      {selected ? (
                        <CheckIcon size={14} />
                      ) : removed ? (
                        "已移除"
                      ) : locked ? (
                        enabling ? "开启中…" : "开启"
                      ) : switching ? (
                        "切换中…"
                      ) : (
                        SPACE_KIND[item.kind]?.short || ""
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!loaded ? <p className="muted space-switch-warn">正在读取空间…</p> : null}
          {loaded && items.length === 0 ? (
            <p className="muted space-switch-warn">{warn || "暂无多余空间"}</p>
          ) : null}
          {loaded && items.length > 0 && warn ? (
            <p className="muted space-switch-warn">{warn}</p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
