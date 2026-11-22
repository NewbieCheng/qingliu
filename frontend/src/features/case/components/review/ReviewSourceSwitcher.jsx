import React, { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@/shared/ui/icons.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";

/**
 * 交易核对标题旁的来源切换：一眼看到当前来源与笔数，多来源时可下拉立刻切换。
 * 挂在 FoldPanel summary 里，必须 stopPropagation，否则会误折叠面板。
 */
export function ReviewSourceSwitcher({ source, choices = [], rowCount, onChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const canSwitch = choices.length > 1;

  useEffect(() => {
    if (!open) return undefined;
    function onDown(event) {
      if (event.target?.closest?.(".ql-select-menu")) return;
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function labelFor(code) {
    return SOURCES[code] ? t(SOURCES[code]) : code || t("case.review.no_source");
  }

  return (
    <span
      className="review-source-switch"
      ref={wrapRef}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`review-source-switch-trigger${open ? " is-open" : ""}${canSwitch ? "" : " is-solo"}`}
        aria-expanded={canSwitch ? open : undefined}
        aria-haspopup={canSwitch ? "listbox" : undefined}
        aria-label={t("case.review.switch_source")}
        title={
          canSwitch
            ? t("case.review.switch_source_tip")
            : t("case.tx_stat_scoped", {
                source: labelFor(source),
                n: rowCount,
              })
        }
        disabled={!canSwitch}
        onClick={() => {
          if (canSwitch) setOpen((value) => !value);
        }}
      >
        <span className="review-source-switch-source">{labelFor(source)}</span>
        <em className="review-source-switch-count">
          {t("case.tx_stat", { n: rowCount })}
        </em>
        {canSwitch ? <ChevronDownIcon size={12} /> : null}
      </button>
      {open ? (
        <ul
          className="review-source-switch-menu"
          role="listbox"
          aria-label={t("case.review.switch_source")}
        >
          {choices.map((value) => {
            const active = value === source;
            return (
              <li key={value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`review-source-switch-option${active ? " is-active" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (!active) onChange(value);
                  }}
                >
                  {labelFor(value)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </span>
  );
}
