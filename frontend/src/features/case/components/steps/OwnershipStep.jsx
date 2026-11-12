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
import { useI18n } from "@/shared/i18n/index.jsx";

const RELATIONSHIPS = ["Self", "配偶", "子女", "Other"];
const RELATIONSHIP_KEYS = { Self: "ownership.rel_self", "配偶": "ownership.rel_spouse", "子女": "ownership.rel_child", Other: "ownership.rel_other" };
const VISIBLE_DOCS = 8;

/**
 * 上传了几份原件，这里就有几行。
 * 每行：这份原件属于谁、与客户什么关系、是否纳入本次测算。
 * 配偶/子女姓名是可选补充，给流水匹配用，不是替代上面的表格。
 */
export function OwnershipStep({ data, onSave, onNext }) {
  const { t } = useI18n();
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
        title={t("ownership.title")}
        description={t("ownership.desc")}
      />

      {docs.length === 0 ? (
        <EmptyState title={t("ownership.empty_title")}>
          <p>{t("ownership.empty_desc")}</p>
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
              toast(t("ownership.confirm_all_prompt"), "error");
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
            <div className="ownership-section-head">
              <h3 className="ownership-section-title">
                {t("ownership.section_title")}
                <small>{t("case.docs_stat", { n: docs.length })}</small>
              </h3>
              <p className="muted ownership-section-hint">
                {t("ownership.section_hint")}
              </p>
            </div>
            <div className="table-wrap table-compact ownership-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("ownership.col_doc")}</th>
                    <th>{t("ownership.col_holder")}</th>
                    <th>{t("ownership.col_relation")}</th>
                    <th>{t("ownership.col_include")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDocs.map((document) => {
                    const scope =
                      data.fields.document_scopes?.[document.id] || {};
                    return (
                      <tr key={document.id}>
                        <td>
                          <span className="ownership-doc-name">
                            {document.name}
                          </span>
                          <small className="ownership-doc-meta">
                            {t("ownership.subject_name", { name: document.meta.subject_name || t("ownership.unidentified") })}
                          </small>
                        </td>
                        <td>
                          <InputWithCheck
                            aria-label={t("case.ownership.holder_label", { name: document.name })}
                            name={`holder_${document.id}`}
                            defaultValue={
                              scope.holder ||
                              document.meta.subject_name ||
                              ""
                            }
                            required
                            checked={!!confirmed[document.id]}
                            onToggle={() => toggleConfirmed(document.id)}
                            checkLabel={t("case.ownership.confirm_holder", { name: document.name })}
                          />
                        </td>
                        <td>
                          <Select
                            aria-label={t("case.ownership.relationship_label", { name: document.name })}
                            name={`relationship_${document.id}`}
                            label={t("case.ownership.relationship_label", { name: document.name })}
                            defaultValue={scope.relationship || "Self"}
                          >
                            {RELATIONSHIPS.map((value) => (
                              <option key={value}>{t(RELATIONSHIP_KEYS[value])}</option>
                            ))}
                          </Select>
                        </td>
                        <td>
                          <Switch
                            name={`include_${document.id}`}
                            label={t("case.ownership.include_label", { name: document.name })}
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
                {showAll ? t("common.collapse") : t("case.ownership.expand_docs", { count: docs.length })}
              </button>
            )}
          </div>

          <FoldPanel
            title={t("case.ownership.family_names_title")}
            className="ownership-extra"
          >
            <p className="muted ownership-section-hint">{t("case.ownership.family_names_hint")}</p>
            <div className="grid2">
              <Field label={t("case.ownership.exclude_spouse_name")}>
                <input
                  name="spouse_name"
                  defaultValue={data.fields.spouse_name || ""}
                  placeholder="Optional"
                />
              </Field>
              <Field label={t("case.ownership.child_name_label")}>
                <input
                  name="child_name"
                  defaultValue={data.fields.child_name || ""}
                  placeholder="Optional"
                />
              </Field>
            </div>
            <Field label={t("case.ownership.note_label")}>
              <textarea
                name="note"
                defaultValue={data.fields.relationship_note || ""}
                placeholder={t("case.ownership.note_placeholder")}
              />
            </Field>
          </FoldPanel>

          <div className="actions-end">
            <button className="primary" disabled={data.busy}>
              {t("case.ownership.save_continue_review")}
            </button>
          </div>
        </Form>
      )}

      <DocumentList data={data} />
    </section>
  );
}
