import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";

export function DeleteMemberDialog({ member, onClose, onConfirm }) {
  if (!member) return null;

  return (
    <Modal
      title="删除成员"
      onClose={onClose}
      className="modal--sm delete-member-dialog"
    >
      <p className="delete-member-dialog-lead">
        将解除 <strong>{member.display || member.username}</strong>
        （{member.username}）与当前企业的关联。工作台个人账号保留，可继续登录个人空间或其他企业。
      </p>
      <Form
        success=""
        onSave={async (form) => {
          await onConfirm(String(form.get("password") || ""));
          onClose();
        }}
      >
        <Field label="输入你的登录密码以确认">
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength="1"
            maxLength="72"
            placeholder="当前管理员密码"
            autoFocus
          />
        </Field>
        <ModalActions>
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary is-danger-action">
            确认删除
          </button>
        </ModalActions>
      </Form>
    </Modal>
  );
}
