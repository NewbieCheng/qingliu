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
        最近操作记录 <small>{count}</small>
      </h2>
      <form
        className="audit-toolbar-tools"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchChange(draft.trim());
        }}
      >
        <SearchInput
          aria-label="搜索操作记录"
          placeholder="搜索成员、详情或动作"
          value={draft}
          onChange={setDraft}
          onSearch={(value) => onSearchChange(value)}
        />
        <Select
          aria-label="按操作类型筛选"
          label="按操作类型筛选"
          className="audit-action-select"
          value={action}
          onChange={(event) => onActionChange(event.target.value)}
        >
          <option value="">全部操作</option>
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
          title={refreshing ? "刷新中…" : "刷新操作记录"}
          aria-label={refreshing ? "刷新中" : "刷新"}
          onClick={onRefresh}
        >
          <RefreshIcon size={14} />
          <span>{refreshing ? "刷新中" : "刷新"}</span>
        </button>
      </form>
    </div>
  );
}
