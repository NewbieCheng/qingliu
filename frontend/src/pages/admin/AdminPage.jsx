import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
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

export function AdminPage() {
  const { t } = useI18n();
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
    toast(t("admin.team_locked_hint"), "error");
  }

  return (
    <main>
      {error && <p className="error">{error}</p>}
      <section className={`card${!teamManaged ? " is-team-locked" : ""}`}>
        {!teamManaged ? (
          <p className="team-locked-banner" role="status">
            {t("admin.team_locked_hint")}
            <span>{t("admin.team_locked_switch_hint")}</span>
          </p>
        ) : null}
        {canManageMembers ? (
          <>
            <div className="toolbar admin-section-toolbar">
              <h2>{t("admin.team_members")}</h2>
              <div className="admin-section-toolbar-actions">
                <button
                  type="button"
                  className="btn-chip"
                  title={t("admin.refresh_members")}
                  aria-label={t("admin.refresh_members")}
                  onClick={() => {
                    invalidateAdmin();
                    void loadUsers(true);
                  }}
                >
                  <RefreshIcon size={14} />
                  <span>{t("common.refresh")}</span>
                </button>
                <button
                  type="button"
                  className="btn-chip is-primary-action"
                  title={t("admin.add_member_title")}
                  aria-label={t("admin.add_member")}
                  onClick={() => setCreateOpen(true)}
                >
                  <UserPlusIcon size={14} />
                  <span>{t("admin.add_member")}</span>
                </button>
              </div>
            </div>
            {!users && !error && (
              <Loading compact text={t("admin.loading_members")} />
            )}
            {users && (
              <TeamTable
                users={users}
                locked={false}
                onLockedAction={refuseTeamAction}
                onToggle={async (userId) => {
                  if (userId === user?.id) {
                    toast(t("admin.cannot_disable_self"), "error");
                    return;
                  }
                  await toggleMember(userId);
                  invalidateAdmin();
                  await Promise.all([loadUsers(true), loadAudit(true)]);
                }}
                onDelete={(member) => {
                  if (member.id === user?.id) {
                    toast(t("admin.cannot_delete_self"), "error");
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
                toast(t("admin.member_removed"));
                invalidateAdmin();
                await Promise.all([loadUsers(true), loadAudit(true)]);
              }}
            />
          </>
        ) : (
          <div className="toolbar admin-section-toolbar">
            <h2>{t("admin.team_members")}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {teamManaged
                ? t("admin.admin_only_members")
                : t("admin.team_locked_hint")}
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
        {!audit && !auditError && (
          <Loading compact text={t("admin.loading_audit")} />
        )}
        {audit && <AuditLogTable events={audit.events} />}
        {audit && (
          <Pagination
            page={page}
            canPrevious={page > 1}
            canNext={page * (audit.page_size || pageSize) < (audit.count || 0)}
            onPrevious={() => setPage(page - 1)}
            onNext={() => setPage(page + 1)}
            label={t("admin.page_label", {
              page,
              size: audit.page_size || pageSize,
            })}
          />
        )}
      </section>
    </main>
  );
}
