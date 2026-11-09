import React, { useCallback, useEffect, useState } from "react";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { invalidateAll, querySpaces } from "@/app/queries/index.js";
import { switchSpace } from "./api.js";

/**
 * 空间切换卡：一个人可以在「自己的个人空间」与「所属企业」之间来回切。
 *
 * # 为什么切换后要整页刷新
 *
 * 空间决定**所有**列表的视角（客户、余额、操作记录、团队与个人资料）。
 * 原地改状态只会刷新这一个页面，用户点回首页仍是上一个空间的数据 ——
 * 那是比报错更糟的「看起来对但其实越权」。这里宁可整页重载，
 * 让每个页面都用新空间重新取数（清流没有全局状态层，这是最可靠的做法）。
 *
 * # 为什么没有「切换到某个企业」的按钮时什么都不显示
 *
 * 只有一种空间的人（大多数个人用户）看到这张卡只会困惑。
 */
export function SpaceCard() {
  const [items, setItems] = useState([]);
  const [warn, setWarn] = useState("");
  const [busy, setBusy] = useState(false);
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

  const canSwitch = items.length > 1;

  async function onSwitch(tenantId) {
    setBusy(true);
    setError("");
    try {
      await switchSpace(tenantId);
      // 见文件头：空间变了，所有页面的数据都要重新取。
      invalidateAll();
      toast("已切换空间，正在刷新…");
      window.location.reload();
    } catch (requestError) {
      toast(requestError.message, "error");
      setError(requestError.message);
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <SectionTitle
        title="空间"
        description="企业资料按团队隔离；个人空间只有你自己能看见。切换只影响当前这台设备的登录，不会改变你在工作台里的归属。"
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="space-list">
        {items.map((item) => (
          <li key={`${item.tenant_id}`} className={item.current ? "space-item current" : "space-item"}>
            <div>
              <strong>{item.personal ? "个人空间" : item.tenant_name || `企业 #${item.tenant_id}`}</strong>
              <span className="space-hint">
                {item.personal ? "只看自己创建的资料" : `${item.role_label || "企业成员"} · 看本企业全部资料`}
              </span>
            </div>
            {item.current ? (
              <span className="badge">当前</span>
            ) : (
              <button
                className="ghost"
                type="button"
                disabled={busy}
                onClick={() => void onSwitch(item.tenant_id)}
              >
                切换到这里
              </button>
            )}
          </li>
        ))}
      </ul>
      {warn && <p className="space-hint">{warn}</p>}
      {!canSwitch && !warn && (
        <p className="space-hint">你目前只属于这一个空间。加入企业后，这里会出现可切换的团队。</p>
      )}
    </section>
  );
}
