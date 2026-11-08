import React, { useEffect, useState } from "react";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import {
  AuditLogControls,
  AuditLogTable,
  CreateMemberForm,
  TeamTable,
  createMember,
  toggleMember,
} from "@/features/admin/index.js";
import {
  invalidateAdmin,
  queryAdminOverview,
  queryAuditEvents,
} from "@/app/queries/index.js";

export function AdminPage() {
  const [users, setUsers] = useState(null);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const pageSize = 20;

  async function loadUsers(force = false) {
    try {
      const data = await queryAdminOverview({ force });
      setUsers(data.users);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function loadAudit(force = false) {
    try {
      const data = await queryAuditEvents(
        { page, page_size: pageSize, q: search, action },
        { force },
      );
      setAudit(data);
      setAuditError("");
    } catch (requestError) {
      setAuditError(requestError.message);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    void loadAudit();
  }, [page, search, action]);

  async function refreshAudit() {
    setRefreshing(true);
    invalidateAdmin();
    await loadAudit(true);
    setRefreshing(false);
  }

  return (
    <main>
      <PageHeader
        eyebrow="团队与权限"
        title="明确分工，保留每次核对。"
        description="业务员与复核员只可访问获授权的客户。管理员可管理全部客户。"
      />
      {error && <p className="error">{error}</p>}
      <section className="card">
        <div className="toolbar">
          <h2>团队成员</h2>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              invalidateAdmin();
              void loadUsers(true);
            }}
          >
            刷新
          </button>
        </div>
        {!users && !error && <Loading compact text="正在读取团队成员…" />}
        {users && (
          <TeamTable
            users={users}
            onToggle={async (userId) => {
              await toggleMember(userId);
              invalidateAdmin();
              await Promise.all([loadUsers(true), loadAudit(true)]);
            }}
          />
        )}
        <CreateMemberForm
          onCreate={async (payload) => {
            await createMember(payload);
            toast("成员已创建");
            invalidateAdmin();
            await Promise.all([loadUsers(true), loadAudit(true)]);
          }}
        />
      </section>
      <section className="card">
        <AuditLogControls
          search={search}
          action={action}
          actions={audit?.actions || []}
          onSearchChange={(value) => {
            setPage(1);
            setSearch(value);
          }}
          onActionChange={(value) => {
            setPage(1);
            setAction(value);
          }}
          page={page}
          pageSize={audit?.page_size || pageSize}
          count={audit?.count || 0}
          onPageChange={setPage}
          onRefresh={refreshAudit}
          refreshing={refreshing}
        />
        {auditError && <p className="error">{auditError}</p>}
        {!audit && !auditError && <Loading compact text="正在读取操作记录…" />}
        {audit && <AuditLogTable events={audit.events} />}
      </section>
    </main>
  );
}
