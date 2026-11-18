import React, { useEffect, useRef } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { CheckIcon } from "@/shared/ui/icons.jsx";

export function CreateMemberSuccessDialog({ member, onClose }) {
  const { t } = useI18n();
  const roleLabelFor = (role) => {
    const key = `role.${role}`;
    const translated = t(key);
    return translated === key ? role || "—" : translated;
  };
  const doneRef = useRef(null);

  useEffect(() => {
    doneRef.current?.focus();
  }, [member]);

  if (!member) return null;

  const roleLabel = roleLabelFor(member.role) || "—";

  return (
    <Modal
      title={t("admin.create_success_title")}
      className="modal--sm create-member-success"
      onClose={onClose}
    >
      <p className="create-member-success-lead">
        <span className="create-member-success-mark" aria-hidden="true">
          <CheckIcon size={14} />
        </span>
        {t("admin.create_success_lead")}
      </p>
      <dl className="create-member-success-meta">
        <div>
          <dt>{t("admin.col_account")}</dt>
          <dd>{member.username}</dd>
        </div>
        <div>
          <dt>{t("admin.col_name")}</dt>
          <dd>{member.display}</dd>
        </div>
        <div>
          <dt>{t("admin.col_role")}</dt>
          <dd>{roleLabel}</dd>
        </div>
      </dl>
      <ModalActions>
        <button
          type="button"
          className="primary"
          ref={doneRef}
          onClick={onClose}
        >
          {t("admin.got_it")}
        </button>
      </ModalActions>
    </Modal>
  );
}
