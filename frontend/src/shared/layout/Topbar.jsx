import React, { useEffect, useState } from "react";
import { ArrowLeftIcon, RailToggleIcon, TopbarToggleIcon } from "@/shared/ui/icons.jsx";
import { Link } from "@/shared/router/index.js";
import { invalidateBalance, queryBalance } from "@/app/queries/index.js";

// 顶栏：左侧收起侧边栏，右侧全局积分 + 刷新 + 收起顶栏。
// 积分牌子原来散在各页页头（个人信息 / 充值各一块），现在统一收进顶栏，
// 页面里不再重复。各页余额变化（如下单支付成功）后 dispatch
// `ql:balance-changed` 事件，顶栏听到就重查。
export function Topbar({
  collapsed,
  onToggle,
  railCollapsed,
  onToggleRail,
  hideRailToggle = false,
  title,
  back,
}) {
  const [points, setPoints] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    try {
      if (force) invalidateBalance();
      const data = await queryBalance({ force });
      setPoints(data?.points_balance ?? null);
    } catch {
      setPoints(null);
    }
  }

  useEffect(() => {
    void load();
    const onChanged = () => void load(true);
    window.addEventListener("ql:balance-changed", onChanged);
    return () => window.removeEventListener("ql:balance-changed", onChanged);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-copy">
        {!hideRailToggle ? (
          <button
            type="button"
            className="topbar-toggle"
            aria-label={railCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!railCollapsed}
            title={railCollapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={onToggleRail}
          >
            <RailToggleIcon collapsed={railCollapsed} />
          </button>
        ) : null}
        {back && (
          <Link className="topbar-back" to={back.to}>
            <ArrowLeftIcon />
            {back.label}
          </Link>
        )}
        {title && <span className="topbar-page-title">{title}</span>}
      </div>
      <div className="topbar-links">
        {points !== null && (
          <span className="topbar-balance">
            可用积分<strong>{Number(points).toLocaleString("zh-CN")}</strong>
          </span>
        )}
        <button
          type="button"
          className="ghost topbar-refresh"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await load(true);
            setRefreshing(false);
          }}
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
        <button
          type="button"
          className="topbar-toggle"
          aria-label={collapsed ? "展开顶栏" : "收起顶栏"}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <TopbarToggleIcon collapsed={collapsed} />
        </button>
      </div>
    </header>
  );
}
