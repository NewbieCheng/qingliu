import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";

export function DeleteMemberDialog({ member, onClose, onConfirm }) {
  const { t } = useI18n();
  if (!member) return null;
  const name = member.display || member.username;

  return (
    <Modal
      title={t("admin.delete_title")}
      onClose={onClose}
      className="modal--sm delete-member-dialog"
    >
      <p className="delete-member-dialog-lead">
        {t("admin.delete_lead_before")} <strong>{name}</strong>
        {t("admin.delete_lead_account", { username: member.username })}
        {t("admin.delete_lead_after")}
      </p>
      <Form
        success=""
        onSave={async (form) => {
          await onConfirm(String(form.get("password") || ""));
          onClose();
        }}
      >
        <Field label={t("admin.delete_password")}>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength="1"
            maxLength="72"
            placeholder={t("admin.delete_password_ph")}
            autoFocus
          />
        </Field>
        <ModalActions>
          <button type="button" className="ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary is-danger-action">
            {t("admin.delete_confirm")}
          </button>
        </ModalActions>
      </Form>
    </Modal>
  );
}
