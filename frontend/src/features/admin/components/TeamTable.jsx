import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Form } from "@/shared/ui/Form.jsx";
import { BanIcon, PlayIcon, TrashIcon } from "@/shared/ui/icons.jsx";

export function TeamTable({
  users,
  onToggle,
  onDelete,
  locked = false,
  onLockedAction,
}) {
  const { t } = useI18n();
  const roleLabel = (role) => {
    const key = `role.${role}`;
    const translated = t(key);
    return translated === key ? role || "—" : translated;
  };
  if (!users.length) {
    return (
      <p className="muted team-empty">
        {locked
          ? t("admin.team_empty_locked")
          : t("admin.team_empty")}
      </p>
    );
  }

  return (
    <div className={`table-wrap${locked ? " is-locked" : ""}`}>
      <table className="admin-team-table">
        <thead>
          <tr>
            <th>{t("admin.col_account")}</th>
            <th>{t("admin.col_name")}</th>
            <th>{t("admin.col_role")}</th>
            <th>{t("admin.col_status")}</th>
            <th className="col-actions">{t("admin.col_actions")}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const label = user.active
              ? t("admin.disable")
              : t("admin.enable");
            const title = user.active
              ? t("admin.disable_account")
              : t("admin.reenable_account");
            const toggleButton = (
              <button
                type="submit"
                className={`btn-chip${user.active ? " is-danger" : " is-ok"}`}
                title={title}
                aria-label={title}
                disabled={locked}
              >
                {user.active ? <BanIcon size={14} /> : <PlayIcon size={14} />}
                <span>{label}</span>
              </button>
            );

            return (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{user.display}</td>
                <td>{roleLabel(user.role)}</td>
                <td>
                  <span
                    className={`status-pill${user.active ? " is-on" : " is-off"}`}
                  >
                    {user.active
                      ? t("admin.status_active")
                      : t("admin.status_inactive")}
                  </span>
                </td>
                <td className="col-actions">
                  <div className="admin-row-actions">
                    {locked ? (
                      <button
                        type="button"
                        className={`btn-chip${user.active ? " is-danger" : " is-ok"}`}
                        disabled
                        title={t("admin.toggle_locked_hint")}
                        onClick={onLockedAction}
                      >
                        {user.active ? (
                          <BanIcon size={14} />
                        ) : (
                          <PlayIcon size={14} />
                        )}
                        <span>{label}</span>
                      </button>
                    ) : (
                      <Form success="" onSave={() => onToggle(user.id)}>
                        {toggleButton}
                      </Form>
                    )}
                    {locked ? (
                      <button
                        type="button"
                        className="btn-chip is-danger"
                        disabled
                        title={t("admin.delete_locked_hint")}
                        onClick={onLockedAction}
                      >
                        <TrashIcon size={14} />
                        <span>{t("admin.delete")}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-chip is-danger"
                        title={t("admin.delete_hint")}
                        aria-label={t("admin.delete_aria", {
                          name: user.display || user.username,
                        })}
                        onClick={() => onDelete(user)}
                      >
                        <TrashIcon size={14} />
                        <span>{t("admin.delete")}</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
