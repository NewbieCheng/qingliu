import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { createClient } from "../api.js";
import { invalidateClients } from "@/app/queries/index.js";
import { navigate } from "@/shared/router/index.js";

export function CreateClientDialog({ onClose }) {
  return (
    <Modal title="新建客户档案" onClose={onClose}>
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
          <input name="company" />
        </Field>
        <label className="check">
          <input type="checkbox" name="authorized" required />
          已获得客户资料处理授权
        </label>
        <button className="primary">创建档案</button>
      </Form>
    </Modal>
  );
}
