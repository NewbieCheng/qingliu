import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { SearchInput } from "@/shared/ui/SearchInput.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import { RefreshIcon } from "@/shared/ui/icons.jsx";
import { invalidateClients, queryClients } from "@/app/queries/index.js";
import { isQingliuAdmin } from "@/shared/lib/constants.js";
import {
  CLIENT_FILTERS,
  ClientsTable,
  CreateClientDialog,
  filterClients,
} from "@/features/clients/index.js";

export function ClientsPage({ user }) {
  const { t } = useI18n();
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
      <div className="card">
        <div className="toolbar clients-toolbar">
          <div className="toolbar-start">
            <SegmentedControl
              aria-label={t("clients.filter_aria_label")}
              options={CLIENT_FILTERS.map((option) => ({
                ...option,
                label: t(option.labelKey),
              }))}
              value={filter}
              onChange={setFilter}
            />
            <span className="muted clients-count">
              {data ? t("clients.count", { count: data.count }) : "—"}
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
                aria-label={t("clients.search_aria_label")}
                placeholder={t("clients.search_placeholder")}
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
              aria-label={t(refreshing ? "clients.refreshing" : "clients.refresh")}
              title={t(refreshing ? "clients.refreshing" : "clients.refresh")}
              onClick={() => void refresh()}
            >
              <RefreshIcon size={15} />
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setCreating(true)}
            >
              {t("clients.create")}
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {!data && !error && <Loading compact text={t("clients.loading")} />}
        {data && visibleClients.length > 0 && (
          <ClientsTable
            clients={visibleClients}
            // 删除档案会连原件一起清掉，属于不可撤销的破坏性操作：
            // 只对管理员开放，普通操作员看不到这个按钮。
            canDelete={isQingliuAdmin(user)}
            onDeleted={() => {
              invalidateClients();
              void refresh();
            }}
          />
        )}
        {data?.clients.length === 0 && (
          <EmptyState title={t("clients.empty_title")}>
            <p>{t("clients.empty_description")}</p>
            <button
              type="button"
              className="primary"
              onClick={() => setCreating(true)}
            >
              {t("clients.create")}
            </button>
          </EmptyState>
        )}
        {data && data.clients.length > 0 && visibleClients.length === 0 && (
          <EmptyState title={t("clients.filtered_empty_title")}>
            <p>{t("clients.filtered_empty_description")}</p>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setFilter("all")}
            >
              {t("clients.show_all")}
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
