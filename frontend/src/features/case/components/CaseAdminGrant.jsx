import React, { useState } from "react";
import { ROLES } from "@/shared/lib/constants.js";
import { api } from "@/shared/api/client.js";
import { Form } from "@/shared/ui/Form.jsx";
import { FormRow, Select } from "@/shared/ui/FormRow.jsx";

export function CaseAdminGrant({ onGrant, onError }) {
  const [admin, setAdmin] = useState(null);

  return (
    <details className="card">
      <summary
        onClick={() => {
          if (!admin) {
            api("/api/admin")
              .then(setAdmin)
              .catch((error) => onError(error.message));
          }
        }}
      >
        分配客户访问权限
      </summary>
      <Form
        onSave={(form) =>
          onGrant({
            user_id: form.get("user_id"),
            revoke: form.get("action") === "revoke",
          })
        }
      >
        <FormRow label="选择成员">
          <Select label="选择成员" name="user_id">
            {admin?.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display}（{ROLES[user.role]}）
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label="权限操作">
          <Select label="权限操作" name="action" defaultValue="grant">
            <option value="grant">授予访问</option>
            <option value="revoke">撤销访问</option>
          </Select>
        </FormRow>
        <div className="ql-row-actions">
          <button>保存权限</button>
        </div>
      </Form>
    </details>
  );
}
