import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { createClient } from "../api.js";
import { invalidateClients } from "@/app/queries/index.js";
import { navigate } from "@/shared/router/index.js";

// 快捷新建客户：
//   - 授权勾选默认打勾（用户每次都要勾，反复勾没有信息量），仍可取消
//   - 客户代号自动聚焦，填完直接回车即可创建
//   - 企业名称选填，留空不影响创建
// 目标是把"新建一个客户"压到一次输入 + 一次回车。
export function CreateClientDialog({ onClose }) {
  const { t } = useI18n();
  return (
    <Modal title={t("clients.create_dialog_title")} onClose={onClose} className="modal--sm">
      <Form
        success={t("clients.create_success")}
        onSave={async (form) => {
          const data = await createClient({
            ...Object.fromEntries(form),
            authorized: form.has("authorized"),
          });
          invalidateClients();
          navigate(`/clients/${data.id}`);
        }}
      >
        <Field label={t("clients.internal_code_label")}>
          <input
            name="name"
            maxLength="120"
            required
            autoFocus
            placeholder={t("clients.internal_code_placeholder")}
          />
        </Field>
        <Field label={t("clients.company_label")}>
          <input name="company" placeholder={t("clients.optional_placeholder")} />
        </Field>
        <div className="form-footer">
          <label className="check">
            <input type="checkbox" name="authorized" required defaultChecked />
            {t("clients.authorization_label")}
          </label>
          <ModalActions className="actions-end">
            <button type="button" className="btn-outline" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="primary">{t("clients.create_record")}</button>
          </ModalActions>
        </div>
        <p className="muted form-hint">{t("clients.quick_create_hint")}</p>
      </Form>
    </Modal>
  );
}
