import React, { useCallback, useEffect, useState } from "react";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { invalidateAll, querySpaces } from "@/app/queries/index.js";
import { enableSpace, switchSpace } from "./api.js";

/**
 * 空间切换卡：一个人可以在自己的个人空间与所属团队之间来回切。
 *
 * # 数据形状（工作台契约）
 *
 * 每一项是 `{kind, id, name, role_label, status, can_enable, current, home}`：
 *   - kind    personal | team | platform；
 *   - status  enabled（可切）| locked（要先开启）| removed（已移除）；
 *   - current 以**本会话**所在的空间为准（服务端算好）。
 * 早先的 `tenant_id` / `personal` / `tenant_name` 三个字段已经没有了：
 * 一个整数表达不了三种空间。
 *
 * # 为什么切换后要整页刷新
 *
 * 空间决定**所有**列表的视角（客户、余额、操作记录、团队与个人资料）。
 * 原地改状态只会刷新这一个页面，用户点回首页仍是上一个空间的数据 ——
 * 那是比报错更糟的「看起来对但其实越权」。这里宁可整页重载，
 * 让每个页面都用新空间重新取数（清流没有全局状态层，这是最可靠的做法）。
 *
 * # 为什么没有可切换的空间时什么都不显示
 *
 * 只有一种空间的人（大多数个人用户）看到这张卡只会困惑。
 */

// SPACE_KIND 把 kind 翻成人话。平台空间在清流里没有视图，说明里写清楚
// 去哪看，否则用户会以为是自己权限坏了。
const SPACE_KIND = {
  personal: { name: "个人空间", hint: "只看自己创建的资料" },
  team: { name: "团队空间", hint: "看本团队全部资料" },
  platform: { name: "平台空间", hint: "平台视图在工作台" },
};

function spaceTitle(item) {
  return item.name || SPACE_KIND[item.kind]?.name || "空间";
}

function spaceHint(item) {
  if (item.kind === "personal") {
    return SPACE_KIND.personal.hint;
  }
  if (item.kind === "platform") {
    return SPACE_KIND.platform.hint;
  }
  return `${item.role_label || "团队成员"} · ${SPACE_KIND.team.hint}`;
}

export function SpaceCard() {
  const [items, setItems] = useState([]);
  const [warn, setWarn] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      // 走 app/queries 的缓存层：与 /api/me 同一套 TTL 与失效规则，
      // 切换空间后 invalidateAll 会把它一起清掉。
      const payload = await querySpaces({ force: true });
      setItems(payload?.items ?? []);
      setWarn(payload?.warn ?? "");
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 「能切」= 除了当前这个之外，至少还有一个已开启的空间。
  const switchable = items.filter((item) => !item.current && item.status !== "removed");
  const canSwitch = switchable.length > 0;

  async function onSwitch(item) {
    setBusy(`switch:${item.kind}:${item.id}`);
    setError("");
    try {
      await switchSpace(item.kind, item.id);
      // 见文件头：空间变了，所有页面的数据都要重新取。
      invalidateAll();
      toast("已切换空间，正在刷新…");
      window.location.reload();
    } catch (requestError) {
      toast(requestError.message, "error");
      setError(requestError.message);
      setBusy("");
    }
  }

  async function onEnable(item) {
    setBusy(`enable:${item.kind}:${item.id}`);
    setError("");
    try {
      // 服务端开启成功后直接回最新列表，不必再发一次 GET。
      const payload = await enableSpace(item.kind, item.id);
      setItems(payload?.items ?? []);
      toast("空间已开启，可以切换了");
    } catch (requestError) {
      toast(requestError.message, "error");
      setError(requestError.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="card">
      <SectionTitle
        title="空间"
        description="团队资料按团队隔离；个人空间只有你自己能看见。切换只影响当前这台设备的登录，不会改变你在工作台里的归属。"
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="space-list">
        {items.map((item) => {
          const key = `${item.kind}:${item.id}`;
          return (
            <li key={key} className={item.current ? "space-item current" : "space-item"}>
              <div>
                <strong>{spaceTitle(item)}</strong>
                <span className="space-hint">{spaceHint(item)}</span>
              </div>
              {item.current ? (
                <span className="badge">当前</span>
              ) : item.status === "removed" ? (
                <span className="badge">已移除</span>
              ) : item.status === "locked" ? (
                <button
                  className="ghost"
                  type="button"
                  disabled={!item.can_enable || busy === `enable:${key}`}
                  onClick={() => void onEnable(item)}
                >
                  {busy === `enable:${key}` ? "正在开启…" : "开启"}
                </button>
              ) : (
                <button
                  className="ghost"
                  type="button"
                  disabled={busy === `switch:${key}`}
                  onClick={() => void onSwitch(item)}
                >
                  {busy === `switch:${key}` ? "正在切换…" : "切换到这里"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {warn && <p className="space-hint">{warn}</p>}
      {!canSwitch && !warn && (
        <p className="space-hint">你目前只属于这一个空间。加入团队后，这里会出现可切换的空间。</p>
      )}
    </section>
  );
}
