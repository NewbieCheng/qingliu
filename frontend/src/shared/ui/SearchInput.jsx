import React from "react";
import { SearchIcon, XIcon } from "./icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

/**
 * 搜索框。
 * - 传 onSearch：右侧放大镜是提交按钮，回车同样提交；输入本身不触发查询。
 * - 不传 onSearch：仅作受控输入（兼容旧用法）。
 */
export function SearchInput({
  value,
  onChange,
  onSearch,
  clearLabel,
  searchLabel,
  ...rest
}) {
  const { t } = useI18n();
  const resolvedClearLabel = clearLabel || t("common.clear_search");
  const resolvedSearchLabel = searchLabel || t("common.search");
  const submitMode = typeof onSearch === "function";

  function submit() {
    if (!submitMode) return;
    onSearch(String(value ?? "").trim());
  }

  function clear() {
    onChange("");
    if (submitMode) onSearch("");
  }

  return (
    <span
      className={`ql-search${submitMode ? " is-submit" : ""}${value ? " has-value" : ""}`}
    >
      {!submitMode ? (
        <span className="ql-search-icon" aria-hidden="true">
          <SearchIcon size={14} />
        </span>
      ) : null}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (submitMode && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        {...rest}
      />
      {value ? (
        <button
          type="button"
          className="ql-search-clear"
          aria-label={resolvedClearLabel}
          title={resolvedClearLabel}
          onClick={clear}
        >
          <XIcon size={13} />
        </button>
      ) : null}
      {submitMode ? (
        <button
          type="button"
          className="ql-search-submit"
          aria-label={resolvedSearchLabel}
          title={resolvedSearchLabel}
          onClick={submit}
        >
          <SearchIcon size={15} />
        </button>
      ) : null}
    </span>
  );
}
