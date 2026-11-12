import React from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { createClient } from "../api.js";
import { invalidateClients } from "@/app/queries/index.js";
import { navigate } from "@/shared/router/index.js";

export function CreateClientDialog({ onClose }) {
  const { t } = useI18n();
  return (
    <Modal title={t("clients.create_dialog_title")} onClose={onClose} className="modal--sm">
      <Form
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
            placeholder={t("clients.internal_code_placeholder")}
          />
        </Field>
        <Field label={t("clients.company_label")}>
          <input name="company" placeholder={t("clients.optional_placeholder")} />
        </Field>
        <div className="form-footer">
          <label className="check">
            <input type="checkbox" name="authorized" required />
            {t("clients.authorization_label")}
          </label>
          <ModalActions className="actions-end">
            <button type="button" className="ghost" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button className="primary">{t("clients.create_record")}</button>
          </ModalActions>
        </div>
      </Form>
    </Modal>
  );
}
