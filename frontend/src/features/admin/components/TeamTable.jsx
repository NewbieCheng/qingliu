import React from "react";
import { ROLES } from "@/shared/lib/constants.js";
import { Form } from "@/shared/ui/Form.jsx";

export function TeamTable({ users, onToggle }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>姓名</th>
            <th>角色</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.display}</td>
              <td>{ROLES[user.role]}</td>
              <td>{user.active ? "启用" : "停用"}</td>
              <td>
                <Form success="" onSave={() => onToggle(user.id)}>
                  <button>{user.active ? "停用账号" : "重新启用"}</button>
                </Form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
