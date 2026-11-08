import React, { useEffect, useState } from "react";
import { Loading } from "@/shared/ui/Loading.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { invalidateClients, queryClients } from "@/app/queries/index.js";
import {
  ClientsTable,
  CreateClientDialog,
} from "@/features/clients/index.js";

export function ClientsPage() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
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

  return (
    <main>
      <PageHeader
        eyebrow="客户档案"
        title="把核对工作，落到每一笔。"
        description="先确认资料归属，再核对交易，最后生成可追溯的报告。"
        actions={
          <button className="primary" onClick={() => setCreating(true)}>
            ＋ 新建客户
          </button>
        }
      />
      <div className="card">
        <div className="toolbar">
          <h2>
            我的客户 <small>{data?.count ?? "—"}</small>
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setQuery(search);
            }}
          >
            <input
              aria-label="搜索客户代号"
              placeholder="搜索客户代号"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button>搜索</button>
            <button
              type="button"
              className="ghost"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                invalidateClients();
                try {
                  setData(await queryClients({ query, page, force: true }));
                } catch (requestError) {
                  setError(requestError.message);
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              {refreshing ? "刷新中…" : "刷新"}
            </button>
          </form>
        </div>
        {error && <p className="error">{error}</p>}
        {!data && !error && <Loading compact text="正在读取客户列表…" />}
        {data && data.clients.length > 0 && (
          <ClientsTable clients={data.clients} />
        )}
        {data?.clients.length === 0 && (
          <EmptyState title="从第一份资料开始">
            <p>新建客户并确认资料处理授权，然后上传流水或征信。</p>
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
