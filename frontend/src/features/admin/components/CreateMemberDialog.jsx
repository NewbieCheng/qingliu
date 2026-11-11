import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/Select.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { UserPlusIcon } from "@/shared/ui/icons.jsx";

export function CreateMemberDialog({ open, onClose, onCreate }) {
  if (!open) return null;

  return (
    <Modal title="Add account" onClose={onClose} className="modal--sm create-member-dialog">
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
          <Field label="Account (email)">
            <input
              name="username"
              type="email"
              maxLength="60"
              required
              placeholder="Same accounts as the workbench admin console"
              autoFocus
            />
          </Field>
          <Field label="Name">
            <input name="display" maxLength="120" required />
          </Field>
          <Field label="Initial password (10–72 bytes)">
            <input
              name="password"
              type="password"
              minLength="10"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Role">
            <Select name="role" label="Role" defaultValue="sales">
              <option value="sales">Sales</option>
              <option value="reviewer">Reviewer</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
        <ModalActions>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
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
