import React, { useEffect, useRef } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { CheckIcon } from "@/shared/ui/icons.jsx";

export function CreateMemberSuccessDialog({ member, onClose }) {
  const { locale } = useI18n();
  const copy = (zh, en) => (locale === "en-US" ? en : zh);
  const roleLabelFor = (role) => {
    const labels = {
      admin: copy("管理员", "Admin"),
      sales: copy("业务员", "Sales"),
      reviewer: copy("复核员", "Reviewer"),
      readonly: copy("只读成员", "Read-only member"),
    };
    return labels[role] || role || "—";
  };
  const doneRef = useRef(null);

  useEffect(() => {
    doneRef.current?.focus();
  }, [member]);

  if (!member) return null;

  const roleLabel = roleLabelFor(member.role) || "—";

  return (
    <Modal
      title={copy("成员已创建", "Member created")}
      className="modal--sm create-member-success"
      onClose={onClose}
    >
      <p className="create-member-success-lead">
        <span className="create-member-success-mark" aria-hidden="true">
          <CheckIcon size={14} />
        </span>
        {copy("工作台账号已就绪，可用初始密码登录清流。", "The Workbench account is ready. Use the initial password to sign in to Qingliu.")}
      </p>
      <dl className="create-member-success-meta">
        <div>
          <dt>{copy("账号", "Account")}</dt>
          <dd>{member.username}</dd>
        </div>
        <div>
          <dt>{copy("姓名", "Name")}</dt>
          <dd>{member.display}</dd>
        </div>
        <div>
          <dt>{copy("角色", "Role")}</dt>
          <dd>{roleLabel}</dd>
        </div>
      </dl>
      <ModalActions>
        <button type="button" className="primary" ref={doneRef} onClick={onClose}>
          {copy("知道了", "Got it")}
        </button>
      </ModalActions>
    </Modal>
  );
}
