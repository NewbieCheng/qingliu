import React, { useEffect, useMemo, useState } from "react";
import { Loading } from "@/shared/ui/Loading.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { SearchInput } from "@/shared/ui/SearchInput.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import { RefreshIcon } from "@/shared/ui/icons.jsx";
import { invalidateClients, queryClients } from "@/app/queries/index.js";
import {
  CLIENT_FILTERS,
  ClientsTable,
  CreateClientDialog,
  filterClients,
} from "@/features/clients/index.js";

export function ClientsPage() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    queryClients({ query, page })
      .then(setData)
      .catch((requestError) => {
        setError(requestError.message);
      });
  }, [query, page]);

  const visibleClients = useMemo(
    () => filterClients(data?.clients || [], filter),
    [data, filter],
  );

  async function refresh() {
    setRefreshing(true);
    invalidateClients();
    try {
      setData(await queryClients({ query, page, force: true }));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="clients-page">
      <PageHeader
        title="我的客户"
        actions={
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            ＋ 新建客户
          </button>
        }
      />
      <div className="card">
        <div className="toolbar clients-toolbar">
          <div className="toolbar-start">
            <SegmentedControl
              aria-label="客户进度筛选"
              options={CLIENT_FILTERS}
              value={filter}
              onChange={setFilter}
            />
            <span className="muted clients-count">
              {data ? `共 ${data.count} 位` : "—"}
            </span>
          </div>
          <div className="toolbar-actions">
            <form
              className="toolbar-search"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setQuery(search.trim());
              }}
            >
              <SearchInput
                aria-label="搜索客户代号"
                placeholder="搜索客户代号"
                value={search}
                onChange={setSearch}
                onSearch={(value) => {
                  setPage(1);
                  setQuery(value);
                }}
              />
            </form>
            <button
              type="button"
              className="ghost icon-btn"
              disabled={refreshing}
              aria-label={refreshing ? "刷新中" : "刷新列表"}
              title={refreshing ? "刷新中…" : "刷新"}
              onClick={() => void refresh()}
            >
              <RefreshIcon size={15} />
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {!data && !error && <Loading compact text="正在读取客户列表…" />}
        {data && visibleClients.length > 0 && (
          <ClientsTable clients={visibleClients} />
        )}
        {data?.clients.length === 0 && (
          <EmptyState title="从第一份资料开始">
            <p>新建客户并确认资料处理授权，然后上传流水或征信。</p>
            <button
              type="button"
              className="primary"
              onClick={() => setCreating(true)}
            >
              ＋ 新建客户
            </button>
          </EmptyState>
        )}
        {data && data.clients.length > 0 && visibleClients.length === 0 && (
          <EmptyState title="当前筛选下没有客户">
            <p>试试切换到「全部」，或翻到其他页。</p>
            <button
              type="button"
              className="ghost"
              onClick={() => setFilter("all")}
            >
              查看全部
            </button>
          </EmptyState>
        )}
        <Pagination
          page={page}
          canPrevious={page !== 1}
          canNext={Boolean(data) && page * 20 < data.count}
          onPrevious={() => setPage(page - 1)}
          onNext={() => setPage(page + 1)}
        />
      </div>
      {creating && (
        <CreateClientDialog
          onClose={() => {
            invalidateClients();
            setCreating(false);
          }}
        />
      )}
    </main>
  );
}
