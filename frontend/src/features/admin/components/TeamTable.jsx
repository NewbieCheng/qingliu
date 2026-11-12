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
  const { locale } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
  const roleLabel = (role) => {
    const labels = {
      admin: copy("管理员", "Admin"),
      sales: copy("业务员", "Sales"),
      reviewer: copy("复核员", "Reviewer"),
      readonly: copy("只读成员", "Read-only member"),
    };
    return labels[role] || role || "—";
  };
  if (!users.length) {
    return (
      <p className="muted team-empty">
          {locked
            ? copy("个人空间没有可管理的团队成员。", "Personal space has no team members to manage.")
            : copy("没有其他成员（当前登录账号不会列在列表中）。", "No other members (the signed-in account is not listed).")}
      </p>
    );
  }

  return (
    <div className={`table-wrap${locked ? " is-locked" : ""}`}>
      <table className="admin-team-table">
        <thead>
          <tr>
            <th>{copy("账号", "Account")}</th>
            <th>{copy("姓名", "Name")}</th>
            <th>{copy("角色", "Role")}</th>
            <th>{copy("状态", "Status")}</th>
            <th className="col-actions">{copy("操作", "Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const label = user.active ? copy("停用", "Disable") : copy("启用", "Enable");
            const title = user.active ? copy("停用账号", "Disable account") : copy("重新启用", "Re-enable account");
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
                    {user.active ? copy("已启用", "Active") : copy("已停用", "Inactive")}
                  </span>
                </td>
                <td className="col-actions">
                  <div className="admin-row-actions">
                    {locked ? (
                      <button
                        type="button"
                        className={`btn-chip${user.active ? " is-danger" : " is-ok"}`}
                        disabled
                        title={copy("个人空间不能启用或停用成员。请开通团队或切换到团队空间。", "Personal space cannot enable or disable members. Open or switch to a team space.")}
                        onClick={onLockedAction}
                      >
                        {user.active ? <BanIcon size={14} /> : <PlayIcon size={14} />}
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
                        title={copy("个人空间不支持删除成员", "Members cannot be removed from personal space")}
                        onClick={onLockedAction}
                      >
                        <TrashIcon size={14} />
                        <span>{copy("删除", "Delete")}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-chip is-danger"
                        title={copy("删除：仅解除企业关联，个人账号保留", "Remove: disconnect from this team; keep the personal account")}
                        aria-label={copy(`删除 ${user.display || user.username}`, `Remove ${user.display || user.username}`)}
                        onClick={() => onDelete(user)}
                      >
                        <TrashIcon size={14} />
                        <span>{copy("删除", "Delete")}</span>
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
