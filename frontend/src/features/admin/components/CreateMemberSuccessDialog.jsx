import React, { useEffect, useRef } from "react";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { CheckIcon } from "@/shared/ui/icons.jsx";
import { ROLES } from "@/shared/lib/constants.js";

export function CreateMemberSuccessDialog({ member, onClose }) {
  const doneRef = useRef(null);

  useEffect(() => {
    doneRef.current?.focus();
  }, [member]);

  if (!member) return null;

  const roleLabel = ROLES[member.role] || member.role || "—";

  return (
    <Modal
      title="成员已开通"
      className="modal--sm create-member-success"
      onClose={onClose}
    >
      <p className="create-member-success-lead">
        <span className="create-member-success-mark" aria-hidden="true">
          <CheckIcon size={14} />
        </span>
        工作台账号已就绪，可用初始密码登录清流。
      </p>
      <dl className="create-member-success-meta">
        <div>
          <dt>账号</dt>
          <dd>{member.username}</dd>
        </div>
        <div>
          <dt>姓名</dt>
          <dd>{member.display}</dd>
        </div>
        <div>
          <dt>角色</dt>
          <dd>{roleLabel}</dd>
        </div>
      </dl>
      <ModalActions>
        <button type="button" className="primary" ref={doneRef} onClick={onClose}>
          知道了
        </button>
      </ModalActions>
    </Modal>
  );
}
