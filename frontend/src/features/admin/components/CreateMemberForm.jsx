import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";

export function CreateMemberForm({ onCreate }) {
  return (
    <details>
      <summary>新增成员</summary>
      <Form
        success=""
        onSave={async (form, element) => {
          await onCreate(Object.fromEntries(form));
          element.reset();
        }}
      >
        <div className="grid2">
          <Field label="账号">
            <input name="username" maxLength="60" required />
          </Field>
          <Field label="姓名">
            <input name="display" maxLength="120" required />
          </Field>
          <Field label="初始密码（10至72字节）">
            <input
              name="password"
              type="password"
              minLength="10"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="角色">
            <select name="role">
              <option value="sales">业务员</option>
              <option value="reviewer">复核员</option>
              <option value="admin">管理员</option>
            </select>
          </Field>
        </div>
        <button className="primary">创建成员</button>
      </Form>
    </details>
  );
}
