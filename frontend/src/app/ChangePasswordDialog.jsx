import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { useAuth } from "@/features/auth/index.js";
import { changePassword } from "@/features/profile/index.js";
import { navigate } from "@/shared/router/index.js";

export function ChangePasswordDialog({ onClose }) {
  const { logout } = useAuth();

  return (
    <Modal title="修改密码" onClose={onClose}>
      <Form
        success="密码已更新，请重新登录"
        onSave={async (form) => {
          await changePassword(Object.fromEntries(form));
          await logout();
          navigate("/login");
        }}
      >
        <Field label="当前密码">
          <input
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="新密码（10至72字节）">
          <input
            name="new_password"
            type="password"
            minLength="10"
            maxLength="72"
            autoComplete="new-password"
            required
          />
        </Field>
        <button className="primary">保存并重新登录</button>
      </Form>
    </Modal>
  );
}
