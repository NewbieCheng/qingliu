import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { createClient } from "../api.js";
import { invalidateClients } from "@/app/queries/index.js";
import { navigate } from "@/shared/router/index.js";

export function CreateClientDialog({ onClose }) {
  return (
    <Modal title="新建客户档案" onClose={onClose} className="modal--sm">
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
        <Field label="客户内部代号">
          <input
            name="name"
            maxLength="120"
            required
            placeholder="请输入内部代号"
          />
        </Field>
        <Field label="企业名称（选填）">
          <input name="company" placeholder="可选" />
        </Field>
        <div className="form-footer">
          <label className="check">
            <input type="checkbox" name="authorized" required />
            已获得客户资料处理授权
          </label>
          <ModalActions className="actions-end">
            <button type="button" className="ghost" onClick={onClose}>
              取消
            </button>
            <button className="primary">创建档案</button>
          </ModalActions>
        </div>
      </Form>
    </Modal>
  );
}
