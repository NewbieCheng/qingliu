import React, { useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { InputWithCheck } from "@/shared/ui/InputWithCheck.jsx";
import { Switch } from "@/shared/ui/Switch.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { DocumentList } from "../DocumentList.jsx";

const RELATIONSHIPS = ["本人", "配偶", "子女", "其他"];

// 持有人表格默认只露 8 行，其余折叠；每行输完点 ✓ 确认后再保存。
const VISIBLE_DOCS = 8;

export function OwnershipStep({ data, onSave, onNext }) {
  const [confirmed, setConfirmed] = useState({});
  const [showAll, setShowAll] = useState(false);
  const visibleDocs = showAll ? data.docs : data.docs.slice(0, VISIBLE_DOCS);

  function toggleConfirmed(id) {
    setConfirmed((previous) => ({ ...previous, [id]: !previous[id] }));
  }

  return (
    <section className="card">
      <SectionTitle
        title="确认持有人与本次范围"
        description="未确认的资料不进入测算。配偶、子女与本人的账户分别核对。"
      />
      <Form
        key={data.customer.revision}
        onSave={async (form) => {
          const unconfirmed = data.docs.filter(
            (document) => !form.get(`holder_${document.id}`)?.trim() || !confirmed[document.id],
          );
          if (unconfirmed.length > 0) {
            toast("请先逐行填写持有人并点击 ✓ 确认", "error");
            return;
          }
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
        <div className="table-wrap table-compact">
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
              {visibleDocs.map((document) => {
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
                      <InputWithCheck
                        aria-label={`${document.name}持有人`}
                        name={`holder_${document.id}`}
                        defaultValue={
                          scope.holder || document.meta.subject_name || ""
                        }
                        required
                        checked={!!confirmed[document.id]}
                        onToggle={() => toggleConfirmed(document.id)}
                        checkLabel={`确认${document.name}持有人`}
                      />
                    </td>
                    <td>
                      <Select
                        aria-label={`${document.name}关系`}
                        name={`relationship_${document.id}`}
                        label={`${document.name}关系`}
                        defaultValue={scope.relationship || "本人"}
                      >
                        {RELATIONSHIPS.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <Switch
                        name={`include_${document.id}`}
                        label={`${document.name}纳入本次`}
                        defaultChecked={scope.include ?? true}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.docs.length > VISIBLE_DOCS && (
          <button
            type="button"
            className="ghost task-toggle"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? "收起" : `展开全部 ${data.docs.length} 份资料`}
          </button>
        )}
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
        <div className="actions-end">
          <button className="primary" disabled={data.busy || !data.docs.length}>
            保存归属进入交易核对
          </button>
        </div>
      </Form>
      <DocumentList data={data} />
    </section>
  );
}
