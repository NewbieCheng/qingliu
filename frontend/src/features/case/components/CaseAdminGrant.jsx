import React, { useState } from "react";
import { ROLES } from "@/shared/lib/constants.js";
import { api } from "@/shared/api/client.js";
import { Form } from "@/shared/ui/Form.jsx";
import { FormRow, Select } from "@/shared/ui/FormRow.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";

export function CaseAdminGrant({ onGrant, onError }) {
  const [open, setOpen] = useState(false);
  const [admin, setAdmin] = useState(null);

  async function openDialog() {
    setOpen(true);
    try {
      // 每次打开都重拉：团队成员以工作台为准，缓存会漏掉新开户的人。
      setAdmin(await api("/api/admin"));
    } catch (error) {
      onError(error.message);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="case-grant-trigger"
        onClick={() => void openDialog()}
      >
        分配访问权限
      </button>
      {open ? (
        <Modal
          title="分配客户访问权限"
          onClose={() => setOpen(false)}
          className="modal--sm"
        >
          <Form
            onSave={async (form) => {
              await onGrant({
                workbench_user_id: Number(form.get("workbench_user_id")),
                revoke: form.get("action") === "revoke",
              });
              setOpen(false);
            }}
          >
            <FormRow label="Select member">
              <Select label="Select member" name="workbench_user_id" required>
                <option value="">请选择工作台成员</option>
                {(admin?.users || []).map((member) => (
                  <option
                    key={member.workbench_user_id || member.id}
                    value={member.workbench_user_id}
                  >
                    {member.display}（{ROLES[member.role]}）
                  </option>
                ))}
              </Select>
            </FormRow>
            <FormRow label="Access actions">
              <Select label="Access actions" name="action" defaultValue="grant">
                <option value="grant">授予访问</option>
                <option value="revoke">撤销访问</option>
              </Select>
            </FormRow>
            <ModalActions>
              <button
                type="button"
                className="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="primary">保存权限</button>
            </ModalActions>
          </Form>
        </Modal>
      ) : null}
    </>
  );
}
