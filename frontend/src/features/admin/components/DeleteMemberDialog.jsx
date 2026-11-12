import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";

export function DeleteMemberDialog({ member, onClose, onConfirm }) {
  const { locale, t } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
  if (!member) return null;

  return (
    <Modal
      title="Remove member"
      onClose={onClose}
      className="modal--sm delete-member-dialog"
    >
      <p className="delete-member-dialog-lead">
        {copy("将解除", "Remove")} <strong>{member.display || member.username}</strong>
        {copy(`（${member.username}）`, `(${member.username})`)}{copy("与当前企业的关联。工作台个人账号保留，可继续登录个人空间或其他企业。", " is no longer part of this team. Their Workbench personal account remains active and can still access personal space or other teams.")}
      </p>
      <Form
        success=""
        onSave={async (form) => {
          await onConfirm(String(form.get("password") || ""));
          onClose();
        }}
      >
        <Field label="Enter your password to confirm">
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength="1"
            maxLength="72"
            placeholder="Current admin password"
            autoFocus
          />
        </Field>
        <ModalActions>
          <button type="button" className="ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary is-danger-action">
            {copy("确认删除", "Confirm removal")}
          </button>
        </ModalActions>
      </Form>
    </Modal>
  );
}
