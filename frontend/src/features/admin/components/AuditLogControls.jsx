import React, { useEffect, useState } from "react";
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
  const [draft, setDraft] = useState(search);

  useEffect(() => {
    setDraft(search);
  }, [search]);

  return (
    <div className="toolbar audit-toolbar">
      <h2>
        Recent activity <small>{count}</small>
      </h2>
      <form
        className="audit-toolbar-tools"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchChange(draft.trim());
        }}
      >
        <SearchInput
          aria-label="Search activity"
          placeholder="Search members, details, or actions"
          value={draft}
          onChange={setDraft}
          onSearch={(value) => onSearchChange(value)}
        />
        <Select
          aria-label="Filter by action type"
          label="Filter by action type"
          className="audit-action-select"
          value={action}
          onChange={(event) => onActionChange(event.target.value)}
        >
          <option value="">All actions</option>
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
          title={refreshing ? "Refreshing…" : "Refresh activity"}
          aria-label={refreshing ? "Refreshing" : "Refresh"}
          onClick={onRefresh}
        >
          <RefreshIcon size={14} />
          <span>{refreshing ? "Refreshing" : "Refresh"}</span>
        </button>
      </form>
    </div>
  );
}
