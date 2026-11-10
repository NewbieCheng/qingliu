import React from "react";
import { ROLES } from "@/shared/lib/constants.js";
import { Form } from "@/shared/ui/Form.jsx";
import { BanIcon, PlayIcon, TrashIcon } from "@/shared/ui/icons.jsx";

export function TeamTable({
  users,
  onToggle,
  onDelete,
  locked = false,
  onLockedAction,
}) {
  if (!users.length) {
    return (
      <p className="muted team-empty">
        {locked
          ? "个人空间没有可管理的团队成员。"
          : "暂无其他成员（当前登录账号不在本列表中）。"}
      </p>
    );
  }

  return (
    <div className={`table-wrap${locked ? " is-locked" : ""}`}>
      <table className="admin-team-table">
        <thead>
          <tr>
            <th>账号</th>
            <th>姓名</th>
            <th>角色</th>
            <th>状态</th>
            <th className="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const label = user.active ? "停用" : "启用";
            const title = user.active ? "停用账号" : "重新启用";
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
                <td>{ROLES[user.role]}</td>
                <td>
                  <span
                    className={`status-pill${user.active ? " is-on" : " is-off"}`}
                  >
                    {user.active ? "启用" : "停用"}
                  </span>
                </td>
                <td className="col-actions">
                  <div className="admin-row-actions">
                    {locked ? (
                      <button
                        type="button"
                        className={`btn-chip${user.active ? " is-danger" : " is-ok"}`}
                        disabled
                        title="个人空间不支持启停成员，请开通或切换到团队空间"
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
                        title="个人空间不支持删除成员"
                        onClick={onLockedAction}
                      >
                        <TrashIcon size={14} />
                        <span>删除</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-chip is-danger"
                        title="删除：仅解除企业关联，个人账号保留"
                        aria-label={`删除 ${user.display || user.username}`}
                        onClick={() => onDelete(user)}
                      >
                        <TrashIcon size={14} />
                        <span>删除</span>
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
