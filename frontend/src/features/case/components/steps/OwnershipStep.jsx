import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { DocumentList } from "../DocumentList.jsx";

const RELATIONSHIPS = ["本人", "配偶", "子女", "其他"];

export function OwnershipStep({ data, onSave, onNext }) {
  return (
    <section className="card">
      <SectionTitle
        title="确认持有人与本次范围"
        description="未确认的资料不进入测算。配偶、子女与本人的账户分别核对。"
      />
      <Form
        key={data.customer.revision}
        onSave={async (form) => {
          const scopes = {};
          data.docs.forEach((document) => {
            scopes[document.id] = {
              holder: form.get(`holder_${document.id}`),
              relationship: form.get(`relationship_${document.id}`),
              include: form.has(`include_${document.id}`),
            };
          });
          await onSave({
            scopes,
            note: form.get("note"),
            spouse_name: form.get("spouse_name"),
            child_name: form.get("child_name"),
          });
          onNext();
        }}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>原件</th>
                <th>持有人</th>
                <th>关系</th>
                <th>纳入本次</th>
              </tr>
            </thead>
            <tbody>
              {data.docs.map((document) => {
                const scope = data.fields.document_scopes?.[document.id] || {};
                return (
                  <tr key={document.id}>
                    <td>
                      {document.name}
                      <small className="block">
                        识别署名：{document.meta.subject_name || "未识别"}
                      </small>
                    </td>
                    <td>
                      <input
                        aria-label={`${document.name}持有人`}
                        name={`holder_${document.id}`}
                        defaultValue={
                          scope.holder || document.meta.subject_name || ""
                        }
                        required
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`${document.name}关系`}
                        name={`relationship_${document.id}`}
                        defaultValue={scope.relationship || "本人"}
                      >
                        {RELATIONSHIPS.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`${document.name}纳入本次`}
                        type="checkbox"
                        name={`include_${document.id}`}
                        defaultChecked={scope.include ?? true}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid2">
          <Field label="需要剔除的配偶完整姓名（选填）">
            <input
              name="spouse_name"
              defaultValue={data.fields.spouse_name || ""}
            />
          </Field>
          <Field label="需要单列的子女完整姓名（选填）">
            <input
              name="child_name"
              defaultValue={data.fields.child_name || ""}
            />
          </Field>
        </div>
        <Field label="归属核对依据">
          <textarea
            name="note"
            defaultValue={data.fields.relationship_note || ""}
          />
        </Field>
        <button className="primary" disabled={data.busy || !data.docs.length}>
          保存归属，进入交易核对
        </button>
      </Form>
      <DocumentList data={data} />
    </section>
  );
}
