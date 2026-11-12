import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";
import { useAuth } from "@/features/auth/index.js";
import { changePassword } from "@/features/profile/index.js";
import { navigate } from "@/shared/router/index.js";

export function ChangePasswordDialog({ onClose }) {
  const { t } = useI18n();
  const { logout } = useAuth();

  return (
    <Modal title={t("auth.password_title")} onClose={onClose}>
      <p className="account-dialog-lead">{t("auth.password_lead")}</p>
      <Form
        success={t("auth.password_success")}
        onSave={async (form) => {
          await changePassword(Object.fromEntries(form));
          await logout();
          navigate("/login");
        }}
      >
        <Field label={t("auth.password_current")}>
          <input
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label={t("auth.password_new")}>
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
            {t("common.cancel")}
          </button>
          <button className="primary">{t("auth.password_save")}</button>
        </div>
      </Form>
    </Modal>
  );
}
