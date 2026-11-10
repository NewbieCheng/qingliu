import React, { useEffect, useState } from "react";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { Loading } from "@/shared/ui/Loading.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { RefreshIcon, UserPlusIcon } from "@/shared/ui/icons.jsx";
import { isQingliuAdmin } from "@/shared/lib/constants.js";
import { useAuth } from "@/features/auth/index.js";
import {
  AuditLogControls,
  AuditLogTable,
  CreateMemberDialog,
  CreateMemberSuccessDialog,
  DeleteMemberDialog,
  TeamTable,
  createMember,
  deleteMember,
  toggleMember,
} from "@/features/admin/index.js";
import {
  invalidateAdmin,
  queryAdminOverview,
  queryAuditEvents,
} from "@/app/queries/index.js";

const TEAM_LOCKED_HINT =
  "个人空间不支持团队成员管理。请开通团队版，或切换到团队空间后再开通/启停工作台成员。";

export function AdminPage() {
  const { user } = useAuth();
  const spaceKind = user?.kind || user?.space?.kind || "personal";
  const teamManaged = spaceKind === "team";
  const canManageMembers = isQingliuAdmin(user) && teamManaged;

  const [users, setUsers] = useState(null);
  const [audit, setAudit] = useState(null);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdMember, setCreatedMember] = useState(null);
  const [deletingMember, setDeletingMember] = useState(null);
  const pageSize = 10;

  async function loadUsers(force = false) {
    if (!canManageMembers) {
      setUsers([]);
      setError("");
      return;
    }
    try {
      const data = await queryAdminOverview({ force });
      const selfId = user?.id;
      const selfWb = Number(user?.workbench_user_id || 0);
      setUsers(
        (data.users || []).filter((member) => {
          if (selfId && member.id === selfId) return false;
          if (selfWb > 0 && Number(member.workbench_user_id || 0) === selfWb) {
            return false;
          }
          return true;
        }),
      );
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
  }, [canManageMembers, user?.id, user?.workbench_user_id]);

  useEffect(() => {
    void loadAudit();
  }, [page, search, action]);

  async function refreshAudit() {
    setRefreshing(true);
    invalidateAdmin();
    await loadAudit(true);
    setRefreshing(false);
  }

  function refuseTeamAction() {
    toast(TEAM_LOCKED_HINT, "error");
  }

  return (
    <main>
      <PageHeader
        title="明确分工，保留每次核对。"
        description={
          teamManaged
            ? "成员账号以工作台为准。业务员与复核员只可访问获授权的客户；管理员可管理全部客户。"
            : "当前是个人空间：可查看自己的操作记录；团队成员管理需开通或切换到团队空间。"
        }
      />
      {error && <p className="error">{error}</p>}
      <section className={`card${!teamManaged ? " is-team-locked" : ""}`}>
        {!teamManaged ? (
          <p className="team-locked-banner" role="status">
            {TEAM_LOCKED_HINT}
            <span>左侧空间切换里可开启锁定的团队，或切到已有团队空间。</span>
          </p>
        ) : null}
        {canManageMembers ? (
          <>
            <div className="toolbar admin-section-toolbar">
              <h2>团队成员</h2>
              <div className="admin-section-toolbar-actions">
                <button
                  type="button"
                  className="btn-chip"
                  title="刷新成员列表"
                  aria-label="刷新成员列表"
                  onClick={() => {
                    invalidateAdmin();
                    void loadUsers(true);
                  }}
                >
                  <RefreshIcon size={14} />
                  <span>刷新</span>
                </button>
                <button
                  type="button"
                  className="btn-chip is-primary-action"
                  title="开通工作台成员"
                  aria-label="新增账号"
                  onClick={() => setCreateOpen(true)}
                >
                  <UserPlusIcon size={14} />
                  <span>新增账号</span>
                </button>
              </div>
            </div>
            {!users && !error && (
              <Loading compact text="正在读取团队成员…" />
            )}
            {users && (
              <TeamTable
                users={users}
                locked={false}
                onLockedAction={refuseTeamAction}
                onToggle={async (userId) => {
                  if (userId === user?.id) {
                    toast("不可停用当前账号", "error");
                    return;
                  }
                  await toggleMember(userId);
                  invalidateAdmin();
                  await Promise.all([loadUsers(true), loadAudit(true)]);
                }}
                onDelete={(member) => {
                  if (member.id === user?.id) {
                    toast("不可删除当前账号", "error");
                    return;
                  }
                  setDeletingMember(member);
                }}
              />
            )}
            <CreateMemberDialog
              open={createOpen}
              onClose={() => setCreateOpen(false)}
              onCreate={async (payload) => {
                await createMember(payload);
                setCreatedMember(payload);
                invalidateAdmin();
                await Promise.all([loadUsers(true), loadAudit(true)]);
              }}
            />
            {createdMember ? (
              <CreateMemberSuccessDialog
                member={createdMember}
                onClose={() => setCreatedMember(null)}
              />
            ) : null}
            <DeleteMemberDialog
              member={deletingMember}
              onClose={() => setDeletingMember(null)}
              onConfirm={async (password) => {
                await deleteMember(deletingMember.id, password);
                toast("已移出企业，个人账号仍保留");
                invalidateAdmin();
                await Promise.all([loadUsers(true), loadAudit(true)]);
              }}
            />
          </>
        ) : (
          <div className="toolbar admin-section-toolbar">
            <h2>团队成员</h2>
            <p className="muted" style={{ margin: 0 }}>
              {teamManaged
                ? "仅管理员可管理团队成员。"
                : TEAM_LOCKED_HINT}
            </p>
          </div>
        )}
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
          count={audit?.count || 0}
          onRefresh={refreshAudit}
          refreshing={refreshing}
        />
        {auditError && <p className="error">{auditError}</p>}
        {!audit && !auditError && <Loading compact text="正在读取操作记录…" />}
        {audit && <AuditLogTable events={audit.events} />}
        {audit && (
          <Pagination
            page={page}
            canPrevious={page > 1}
            canNext={page * (audit.page_size || pageSize) < (audit.count || 0)}
            onPrevious={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
            label={`第 ${page} 页 · 每页 ${audit.page_size || pageSize} 条`}
          />
        )}
      </section>
    </main>
  );
}
