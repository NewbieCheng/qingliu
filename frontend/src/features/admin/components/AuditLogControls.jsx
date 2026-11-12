import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { SearchInput } from "@/shared/ui/SearchInput.jsx";
import { Select } from "@/shared/ui/Select.jsx";
import { RefreshIcon } from "@/shared/ui/icons.jsx";

export function AuditLogControls({
  search,
  action,
  actions,
  onSearchChange,
  onActionChange,
  count,
  onRefresh,
  refreshing,
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(search);

  useEffect(() => {
    setDraft(search);
  }, [search]);

  return (
    <div className="toolbar audit-toolbar">
      <h2>
        {t("admin.audit_title")} <small>{count}</small>
      </h2>
      <form
        className="audit-toolbar-tools"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchChange(draft.trim());
        }}
      >
        <SearchInput
          aria-label={t("admin.audit_search")}
          placeholder={t("admin.audit_search_placeholder")}
          value={draft}
          onChange={setDraft}
          onSearch={(value) => onSearchChange(value)}
        />
        <Select
          aria-label={t("admin.audit_filter")}
          label={t("admin.audit_filter")}
          className="audit-action-select"
          value={action}
          onChange={(event) => onActionChange(event.target.value)}
        >
          <option value="">{t("admin.audit_all_actions")}</option>
          {actions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className="btn-chip"
          disabled={refreshing}
          title={refreshing ? t("admin.audit_refreshing") : t("admin.audit_refresh_title")}
          aria-label={refreshing ? t("admin.audit_refreshing") : t("admin.audit_refresh")}
          onClick={onRefresh}
        >
          <RefreshIcon size={14} />
          <span>{refreshing ? t("admin.audit_refreshing") : t("admin.audit_refresh")}</span>
        </button>
      </form>
    </div>
  );
}
