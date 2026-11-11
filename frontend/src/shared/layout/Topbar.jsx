import React, { useEffect, useState } from "react";
import { ArrowLeftIcon, RailToggleIcon, TopbarToggleIcon } from "@/shared/ui/icons.jsx";
import { Link } from "@/shared/router/index.js";
import { useI18n } from "@/shared/i18n/index.jsx";
import { LanguageSwitch } from "@/shared/ui/LanguageSwitch.jsx";
import { invalidateBalance, queryBalance } from "@/app/queries/index.js";
import {
  availablePoints,
  periodExpiresAt,
  periodPoints,
  permanentPoints,
} from "@/shared/lib/billing.js";

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
  const { t } = useI18n();
  const [points, setPoints] = useState(null);
  const [balance, setBalance] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    try {
      if (force) invalidateBalance();
      const data = await queryBalance({ force });
      setPoints(availablePoints(data));
      setBalance(data);
    } catch {
      setPoints(null);
      setBalance(null);
    }
  }

  useEffect(() => {
    void load();
    const onChanged = () => void load(true);
    window.addEventListener("ql:balance-changed", onChanged);
    return () => window.removeEventListener("ql:balance-changed", onChanged);
  }, []);

  // 顶栏只放数字，但必须能一眼分辨永久/临时：鼠标悬停给出拆分与到期日，
  // 否则「可用 1、扣费却说不够/或者月底突然清零」没人解释得清。
  const permanent = permanentPoints(balance);
  const period = periodPoints(balance);
  const expires = periodExpiresAt(balance);
  const balanceTitle =
    points === null
      ? undefined
      : t("topbar.points_title", {
          total: Number(points).toLocaleString(),
          permanent: Number(permanent).toLocaleString(),
          period: Number(period).toLocaleString(),
          expire: period > 0 && expires
            ? t("topbar.points_expire", { at: expires.toLocaleString() })
            : "",
        });

  return (
    <header className="topbar">
      <div className="topbar-copy">
        {!hideRailToggle ? (
          <button
            type="button"
            className="topbar-toggle"
            aria-label={t(railCollapsed ? "topbar.expand_rail" : "topbar.collapse_rail")}
            aria-expanded={!railCollapsed}
            title={t(railCollapsed ? "topbar.expand_rail" : "topbar.collapse_rail")}
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
          <span className="topbar-balance" title={balanceTitle}>
            {t("topbar.points")}<strong>{Number(points).toLocaleString()}</strong>
            {period > 0 && (
              <small className="topbar-balance-period">
                {t("topbar.points_period", { n: Number(period).toLocaleString() })}
              </small>
            )}
          </span>
        )}
        <LanguageSwitch />
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
          {refreshing ? t("topbar.refreshing") : t("topbar.refresh")}
        </button>
        <button
          type="button"
          className="topbar-toggle"
          aria-label={t(collapsed ? "topbar.expand" : "topbar.collapse")}
          aria-expanded={!collapsed}
          title={t(collapsed ? "topbar.expand" : "topbar.collapse")}
          onClick={onToggle}
        >
          <TopbarToggleIcon collapsed={collapsed} />
        </button>
      </div>
    </header>
  );
}
