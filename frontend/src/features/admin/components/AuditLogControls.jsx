import React, { useEffect, useState } from "react";
import { Pagination } from "@/shared/ui/Pagination.jsx";

export function AuditLogControls({
  search,
  action,
  actions,
  onSearchChange,
  onActionChange,
  page,
  pageSize,
  count,
  onPageChange,
  onRefresh,
  refreshing,
}) {
  const [draft, setDraft] = useState(search);

  useEffect(() => {
    setDraft(search);
  }, [search]);

  return (
    <>
      <div className="toolbar audit-toolbar">
        <h2>
          最近操作记录 <small>{count}</small>
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSearchChange(draft.trim());
          }}
        >
          <input
            aria-label="搜索操作记录"
            placeholder="搜索成员、详情或动作"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <select
            aria-label="按操作类型筛选"
            value={action}
            onChange={(event) => onActionChange(event.target.value)}
          >
            <option value="">全部操作</option>
            {actions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="submit">搜索</button>
          <button
            type="button"
            className="ghost"
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? "刷新中…" : "刷新"}
          </button>
        </form>
      </div>
      <Pagination
        page={page}
        canPrevious={page > 1}
        canNext={page * pageSize < count}
        onPrevious={() => onPageChange(page - 1)}
        onNext={() => onPageChange(page + 1)}
        label={`第 ${page} 页 · 每页 ${pageSize} 条`}
      />
    </>
  );
}
