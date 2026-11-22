import React from "react";
import { RailToggleIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { useChromeTitle } from "./ChromeTitle.jsx";

const TITLE_MAX_CHARS = 12;

function truncateTitle(value, max = TITLE_MAX_CHARS) {
  const chars = Array.from(String(value || "").trim());
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max).join("")}…`;
}

// 顶栏：收起态才显示侧栏开关（最左）；展开时开关在侧栏品牌右侧。
// 标题 + 按需配件（如个人信息页签）；积分已迁到侧栏 SpaceSwitcher。
export function Topbar({
  railCollapsed,
  onToggleRail,
  hideRailToggle = false,
}) {
  const { t } = useI18n();
  const { title, accessoryHostRef, centerHostRef } = useChromeTitle();
  const showRailToggle = !hideRailToggle && railCollapsed;
  const displayTitle = title ? truncateTitle(title) : "";

  return (
    <header className={`topbar${showRailToggle ? " has-rail-toggle" : ""}`}>
      <div className="topbar-copy">
        {showRailToggle ? (
          <button
            type="button"
            className="topbar-toggle topbar-toggle--rail"
            aria-label={t("topbar.expand_rail")}
            aria-expanded={false}
            title={t("topbar.expand_rail")}
            onClick={onToggleRail}
          >
            <RailToggleIcon collapsed />
          </button>
        ) : null}
        <div className="topbar-heading">
          {displayTitle ? (
            <h1 className="topbar-page-title" title={title}>
              {displayTitle}
            </h1>
          ) : null}
        </div>
        <div className="topbar-accessory" ref={accessoryHostRef} />
      </div>
      <div className="topbar-center" ref={centerHostRef} />
      <div className="topbar-links" aria-hidden="true" />
    </header>
  );
}
