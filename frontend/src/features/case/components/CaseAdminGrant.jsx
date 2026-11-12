import React, { useState } from "react";
import { api } from "@/shared/api/client.js";
import { Form } from "@/shared/ui/Form.jsx";
import { FormRow, Select } from "@/shared/ui/FormRow.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

export function CaseAdminGrant({ onGrant, onError }) {
  const { t } = useI18n();
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
        {t("case.grant.trigger")}
      </button>
      {open ? (
        <Modal
          title={t("case.grant.title")}
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
            <FormRow label={t("case.grant.select_member")}>
              <Select label={t("case.grant.select_member")} name="workbench_user_id" required>
                <option value="">{t("case.grant.choose_member")}</option>
                {(admin?.users || []).map((member) => (
                  <option
                    key={member.workbench_user_id || member.id}
                    value={member.workbench_user_id}
                  >
                    {member.display} ({t(`role.${member.role}`) === `role.${member.role}` ? member.role : t(`role.${member.role}`)})
                  </option>
                ))}
              </Select>
            </FormRow>
            <FormRow label={t("case.grant.access_actions")}>
              <Select label={t("case.grant.access_actions")} name="action" defaultValue="grant">
                <option value="grant">{t("case.grant.grant_access")}</option>
                <option value="revoke">{t("case.grant.revoke_access")}</option>
              </Select>
            </FormRow>
            <ModalActions>
              <button
                type="button"
                className="ghost"
                onClick={() => setOpen(false)}
              >
                {t("common.cancel")}
              </button>
              <button className="primary">{t("case.grant.save_permission")}</button>
            </ModalActions>
          </Form>
        </Modal>
      ) : null}
    </>
  );
}
