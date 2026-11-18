import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/Select.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { UserPlusIcon } from "@/shared/ui/icons.jsx";

export function CreateMemberDialog({ open, onClose, onCreate }) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <Modal
      title={t("admin.create_title")}
      onClose={onClose}
      className="modal--sm create-member-dialog"
    >
      <p className="muted create-member-dialog-lead">
        {t("admin.create_lead")}
      </p>
      <Form
        className="create-member-form"
        success=""
        onSave={async (form, element) => {
          await onCreate(Object.fromEntries(form));
          element.reset();
          onClose();
        }}
      >
        <div className="grid2">
          <Field label={t("admin.create_account")}>
            <input
              name="username"
              type="email"
              maxLength="60"
              required
              placeholder={t("admin.create_account_ph")}
              autoFocus
            />
          </Field>
          <Field label={t("admin.create_name")}>
            <input name="display" maxLength="120" required />
          </Field>
          <Field label={t("admin.create_password")}>
            <input
              name="password"
              type="password"
              minLength="10"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label={t("admin.col_role")}>
            <Select name="role" label={t("admin.col_role")} defaultValue="sales">
              <option value="sales">{t("role.sales")}</option>
              <option value="reviewer">{t("role.reviewer")}</option>
              <option value="admin">{t("role.admin")}</option>
            </Select>
          </Field>
        </div>
        <ModalActions>
          <button type="button" className="ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary btn-with-icon">
            <UserPlusIcon size={15} />
            <span>{t("admin.create_submit")}</span>
          </button>
        </ModalActions>
      </Form>
    </Modal>
  );
}
