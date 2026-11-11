import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { useAuth } from "@/features/auth/index.js";
import { changePassword } from "@/features/profile/index.js";
import { navigate } from "@/shared/router/index.js";

export function ChangePasswordDialog({ onClose }) {
  const { logout } = useAuth();

  return (
    <Modal title="Change password" onClose={onClose}>
      <p className="account-dialog-lead">
        When linked to the workbench, password changes sync there. New password must be 10–72 bytes; you will be signed out after success.
      </p>
      <Form
        success="Password updated. Please sign in again."
        onSave={async (form) => {
          await changePassword(Object.fromEntries(form));
          await logout();
          navigate("/login");
        }}
      >
        <Field label="Current password">
          <input
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="New password (10–72 bytes)">
          <input
            name="new_password"
            type="password"
            minLength="10"
            maxLength="72"
            autoComplete="new-password"
            required
          />
        </Field>
        <div className="account-dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save and sign in again</button>
        </div>
      </Form>
    </Modal>
  );
}
