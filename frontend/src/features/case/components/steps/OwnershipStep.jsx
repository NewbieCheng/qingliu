import React, { useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { InputWithCheck } from "@/shared/ui/InputWithCheck.jsx";
import { Switch } from "@/shared/ui/Switch.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { DocumentList } from "../DocumentList.jsx";

const RELATIONSHIPS = ["本人", "配偶", "子女", "其他"];
const VISIBLE_DOCS = 8;

/**
 * 上传了几份原件，这里就有几行。
 * 每行：这份原件属于谁、与客户什么关系、是否纳入本次测算。
 * 配偶/子女姓名是可选补充，给流水匹配用，不是替代上面的表格。
 */
export function OwnershipStep({ data, onSave, onNext }) {
  const [confirmed, setConfirmed] = useState({});
  const [showAll, setShowAll] = useState(false);
  const docs = data.docs || [];
  const visibleDocs = showAll ? docs : docs.slice(0, VISIBLE_DOCS);

  function toggleConfirmed(id) {
    setConfirmed((previous) => ({ ...previous, [id]: !previous[id] }));
  }

  return (
    <section className="card ownership-card">
      <SectionTitle
        title="确认持有人与本次范围"
        description="有几份原件就填几行；未确认的资料不进入测算。"
      />

      {docs.length === 0 ? (
        <EmptyState title="还没有可确认的资料">
          <p>
            请先回到「上传资料」上传流水或征信。上传多份时，这里会按原件逐行列出持有人、关系和是否纳入。
          </p>
        </EmptyState>
      ) : (
        <Form
          key={data.customer.revision}
          onSave={async (form) => {
            const unconfirmed = docs.filter(
              (document) =>
                !form.get(`holder_${document.id}`)?.trim() ||
                !confirmed[document.id],
            );
            if (unconfirmed.length > 0) {
              toast("请先逐行填写持有人并点击 ✓ 确认", "error");
              return;
            }
            const scopes = {};
            docs.forEach((document) => {
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
          <div className="ownership-section">
            <h3 className="ownership-section-title">
              ① 逐份确认原件
              <small>{docs.length} 份</small>
            </h3>
            <p className="muted ownership-section-hint">
              「持有人」填账户实际归属人；「关系」相对本客户；关掉「纳入本次」则该份不进测算。
            </p>
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
                    const scope =
                      data.fields.document_scopes?.[document.id] || {};
                    return (
                      <tr key={document.id}>
                        <td>
                          {document.name}
                          <small className="block">
                            识别署名：
                            {document.meta.subject_name || "未识别"}
                          </small>
                        </td>
                        <td>
                          <InputWithCheck
                            aria-label={`${document.name}持有人`}
                            name={`holder_${document.id}`}
                            defaultValue={
                              scope.holder ||
                              document.meta.subject_name ||
                              ""
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
            {docs.length > VISIBLE_DOCS && (
              <button
                type="button"
                className="ghost task-toggle"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll
                  ? "收起"
                  : `展开全部 ${docs.length} 份资料`}
              </button>
            )}
          </div>

          <FoldPanel
            title="② 可选：家庭成员姓名（流水匹配）"
            className="ownership-extra"
          >
            <p className="muted ownership-section-hint">
              不是替代上面表格。若流水里会出现配偶/子女姓名，可在此填写以便规则匹配；没有就留空。
            </p>
            <div className="grid2">
              <Field label="需要剔除的配偶完整姓名">
                <input
                  name="spouse_name"
                  defaultValue={data.fields.spouse_name || ""}
                  placeholder="选填"
                />
              </Field>
              <Field label="需要单列的子女完整姓名">
                <input
                  name="child_name"
                  defaultValue={data.fields.child_name || ""}
                  placeholder="选填"
                />
              </Field>
            </div>
            <Field label="归属核对依据">
              <textarea
                name="note"
                defaultValue={data.fields.relationship_note || ""}
                placeholder="可选：写清核对依据"
              />
            </Field>
          </FoldPanel>

          <div className="actions-end">
            <button className="primary" disabled={data.busy}>
              保存归属进入交易核对
            </button>
          </div>
        </Form>
      )}

      <DocumentList data={data} />
    </section>
  );
}
