import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/Select.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { UserPlusIcon } from "@/shared/ui/icons.jsx";

export function CreateMemberDialog({ open, onClose, onCreate }) {
  if (!open) return null;

  return (
    <Modal title="新增账号" onClose={onClose} className="modal--sm create-member-dialog">
      <p className="muted create-member-dialog-lead">
        在工作台开通企业成员；个人账号与企业关联同一邮箱，清流角色写在产品权限里。
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
          <Field label="账号（邮箱）">
            <input
              name="username"
              type="email"
              maxLength="60"
              required
              placeholder="与工作台管理后台同一套账号"
              autoFocus
            />
          </Field>
          <Field label="姓名">
            <input name="display" maxLength="120" required />
          </Field>
          <Field label="初始密码（10至72字节）">
            <input
              name="password"
              type="password"
              minLength="10"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="角色">
            <Select name="role" label="角色" defaultValue="sales">
              <option value="sales">业务员</option>
              <option value="reviewer">复核员</option>
              <option value="admin">管理员</option>
            </Select>
          </Field>
        </div>
        <ModalActions>
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary btn-with-icon">
            <UserPlusIcon size={15} />
            <span>开通成员</span>
          </button>
        </ModalActions>
      </Form>
    </Modal>
  );
}
