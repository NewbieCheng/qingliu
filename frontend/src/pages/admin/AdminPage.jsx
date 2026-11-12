import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
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

function teamLockedHint(copy) {
  return copy(
    "个人空间不支持团队成员管理。请开通团队套餐或切换到团队空间。",
    "Personal space does not support team members. Open a Team plan or switch to a team space before managing members.",
  );
}

export function AdminPage() {
  const { locale } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
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
    toast(teamLockedHint(copy), "error");
  }

  return (
    <main>
      <PageHeader
        title={copy("明确分工，保留每次核对。", "Clear responsibilities, traceable reviews.")}
        description={
          teamManaged
            ? copy("成员账号由工作台管理。业务员和复核员只能查看获授权的客户；管理员可以管理全部客户。", "Member accounts follow the Workbench. Sales and reviewers only see granted customers; admins manage all customers.")
            : copy("个人空间只能查看自己的活动记录。团队成员管理需要先进入团队空间。", "Personal space shows your own activity. Team member management requires a team space.")
        }
      />
      {error && <p className="error">{error}</p>}
      <section className={`card${!teamManaged ? " is-team-locked" : ""}`}>
        {!teamManaged ? (
          <p className="team-locked-banner" role="status">
            {teamLockedHint(copy)}
            <span>{copy("左侧空间切换里可开启锁定的团队，或切到已有团队空间。", "Enable a locked team or switch to an existing team space using the space switcher on the left.")}</span>
          </p>
        ) : null}
        {canManageMembers ? (
          <>
            <div className="toolbar admin-section-toolbar">
              <h2>{copy("团队成员", "Team members")}</h2>
              <div className="admin-section-toolbar-actions">
                <button
                  type="button"
                  className="btn-chip"
                  title={copy("刷新成员", "Refresh members")}
                  aria-label={copy("刷新成员", "Refresh members")}
                  onClick={() => {
                    invalidateAdmin();
                    void loadUsers(true);
                  }}
                >
                  <RefreshIcon size={14} />
                  <span>{copy("刷新", "Refresh")}</span>
                </button>
                <button
                  type="button"
                  className="btn-chip is-primary-action"
                  title={copy("开通工作台成员", "Add Workbench member")}
                  aria-label={copy("添加成员", "Add account")}
                  onClick={() => setCreateOpen(true)}
                >
                  <UserPlusIcon size={14} />
                  <span>{copy("添加成员", "Add account")}</span>
                </button>
              </div>
            </div>
            {!users && !error && (
              <Loading compact text={copy("正在读取团队成员…", "Loading team members…")} />
            )}
            {users && (
              <TeamTable
                users={users}
                locked={false}
                onLockedAction={refuseTeamAction}
                onToggle={async (userId) => {
                  if (userId === user?.id) {
                    toast(copy("不能停用当前登录账号", "Cannot disable the current account"), "error");
                    return;
                  }
                  await toggleMember(userId);
                  invalidateAdmin();
                  await Promise.all([loadUsers(true), loadAudit(true)]);
                }}
                onDelete={(member) => {
                  if (member.id === user?.id) {
                    toast(copy("不能删除当前登录账号", "Cannot delete the current account"), "error");
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
                toast(copy("已移出企业，个人账号仍保留", "Member removed from the team. Their personal account remains active."));
                invalidateAdmin();
                await Promise.all([loadUsers(true), loadAudit(true)]);
              }}
            />
          </>
        ) : (
          <div className="toolbar admin-section-toolbar">
            <h2>{copy("团队成员", "Team members")}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {teamManaged
                ? copy("仅管理员可管理团队成员。", "Only admins can manage team members.")
                : teamLockedHint(copy)}
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
        {!audit && !auditError && <Loading compact text={copy("正在读取操作记录…", "Loading activity…")} />}
        {audit && <AuditLogTable events={audit.events} />}
        {audit && (
          <Pagination
            page={page}
            canPrevious={page > 1}
            canNext={page * (audit.page_size || pageSize) < (audit.count || 0)}
            onPrevious={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
            label={copy(`第 ${page} 页 · 每页 ${audit.page_size || pageSize} 条`, `Page ${page} · ${audit.page_size || pageSize} per page`)}
          />
        )}
      </section>
    </main>
  );
}
