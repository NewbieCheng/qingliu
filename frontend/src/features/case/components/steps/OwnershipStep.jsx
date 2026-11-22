import React, { useEffect, useRef, useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { InputWithCheck } from "@/shared/ui/InputWithCheck.jsx";
import { Switch } from "@/shared/ui/Switch.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { UserPlusIcon } from "@/shared/ui/icons.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { DocumentList } from "../DocumentList.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

const RELATIONSHIPS = ["Self", "配偶", "子女", "Other"];
const RELATIONSHIP_KEYS = {
  Self: "ownership.rel_self",
  配偶: "ownership.rel_spouse",
  子女: "ownership.rel_child",
  Other: "ownership.rel_other",
};
const VISIBLE_DOCS = 8;

function hasFamilyExtras(fields = {}) {
  return Boolean(
    String(fields.spouse_name || "").trim() ||
      String(fields.child_name || "").trim() ||
      String(fields.relationship_note || "").trim(),
  );
}

/**
 * 上传了几份原件，这里就有几行。
 * 每行：这份原件属于谁、与客户什么关系、是否纳入本次测算。
 * 家庭补充对齐「核对规则」：标题行右侧按钮 → 二级浮层，不占主流程。
 */
export function OwnershipStep({ data, onSave, onNext }) {
  const { t } = useI18n();
  const [confirmed, setConfirmed] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const familyWrapRef = useRef(null);
  const docs = data.docs || [];
  const visibleDocs = showAll ? docs : docs.slice(0, VISIBLE_DOCS);
  const familyFilled = hasFamilyExtras(data.fields);

  function toggleConfirmed(id) {
    setConfirmed((previous) => ({ ...previous, [id]: !previous[id] }));
  }

  useEffect(() => {
    if (!familyOpen) return undefined;
    function onDown(event) {
      if (!familyWrapRef.current?.contains(event.target)) setFamilyOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setFamilyOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [familyOpen]);

  return (
    <section className="card ownership-card">
      {docs.length === 0 ? (
        <>
          <header className="ownership-page-head">
            <div className="ownership-page-row">
              <h2 className="ownership-page-title">{t("ownership.title")}</h2>
            </div>
            <p className="muted ownership-page-desc">{t("ownership.desc")}</p>
          </header>
          <EmptyState title={t("ownership.empty_title")}>
            <p>{t("ownership.empty_desc")}</p>
          </EmptyState>
        </>
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
          <header className="ownership-page-head">
            <div className="ownership-page-row">
              <h2 className="ownership-page-title">{t("ownership.title")}</h2>
              <small className="ownership-page-count">
                {t("case.docs_stat", { n: docs.length })}
              </small>
              <div className="ownership-family-wrap" ref={familyWrapRef}>
                <button
                  type="button"
                  className={`btn-outline btn-compact${familyOpen ? " is-active" : ""}`}
                  aria-expanded={familyOpen}
                  aria-haspopup="dialog"
                  onClick={() => setFamilyOpen((value) => !value)}
                >
                  <UserPlusIcon size={13} />
                  {t("case.ownership.family_names_title")}
                  {familyFilled ? (
                    <em className="fold-panel-badge">{t("case.ownership.family_filled")}</em>
                  ) : null}
                </button>
                {/* 不卸载：关掉浮层仍保留输入，提交主表时一起带走 */}
                <div
                  className="ownership-family-pop ql-secondary-pop"
                  role="dialog"
                  aria-label={t("case.ownership.family_names_title")}
                  hidden={!familyOpen}
                >
                  <header className="ql-secondary-pop-head">
                    <strong className="ql-secondary-pop-title">
                      {t("case.ownership.family_names_title")}
                    </strong>
                    <p className="ql-secondary-pop-hint">
                      {t("case.ownership.family_names_hint")}
                    </p>
                  </header>
                  <div className="ql-secondary-pop-body ownership-extra-fields">
                    <Field
                      className="ownership-extra-field"
                      label={t("case.ownership.exclude_spouse_name")}
                    >
                      <input
                        name="spouse_name"
                        defaultValue={data.fields.spouse_name || ""}
                        placeholder={t("case.ownership.exclude_spouse_placeholder")}
                        autoComplete="off"
                      />
                    </Field>
                    <Field
                      className="ownership-extra-field"
                      label={t("case.ownership.child_name_label")}
                    >
                      <input
                        name="child_name"
                        defaultValue={data.fields.child_name || ""}
                        placeholder={t("case.ownership.child_name_placeholder")}
                        autoComplete="off"
                      />
                    </Field>
                    <Field
                      className="ownership-extra-field ownership-extra-note"
                      label={t("case.ownership.note_label")}
                    >
                      <input
                        name="note"
                        defaultValue={data.fields.relationship_note || ""}
                        placeholder={t("case.ownership.note_placeholder")}
                        autoComplete="off"
                      />
                    </Field>
                  </div>
                  <footer className="ql-secondary-pop-foot">
                    <button
                      type="button"
                      className="primary btn-compact"
                      onClick={() => setFamilyOpen(false)}
                    >
                      {t("case.ownership.family_done")}
                    </button>
                  </footer>
                </div>
              </div>
            </div>
            <p
              className="muted ownership-page-desc"
              title={t("ownership.section_hint")}
            >
              {t("ownership.desc")}
            </p>
          </header>

          <div className="ownership-section">
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
                            {t("ownership.subject_name", {
                              name:
                                document.meta.subject_name ||
                                t("ownership.unidentified"),
                            })}
                          </small>
                        </td>
                        <td>
                          <InputWithCheck
                            aria-label={t("case.ownership.holder_label", {
                              name: document.name,
                            })}
                            name={`holder_${document.id}`}
                            defaultValue={
                              scope.holder ||
                              document.meta.subject_name ||
                              ""
                            }
                            required
                            checked={!!confirmed[document.id]}
                            onToggle={() => toggleConfirmed(document.id)}
                            checkLabel={t("case.ownership.confirm_holder", {
                              name: document.name,
                            })}
                          />
                        </td>
                        <td>
                          <Select
                            aria-label={t("case.ownership.relationship_label", {
                              name: document.name,
                            })}
                            name={`relationship_${document.id}`}
                            label={t("case.ownership.relationship_label", {
                              name: document.name,
                            })}
                            defaultValue={scope.relationship || "Self"}
                          >
                            {RELATIONSHIPS.map((value) => (
                              <option key={value}>
                                {t(RELATIONSHIP_KEYS[value])}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td>
                          <Switch
                            name={`include_${document.id}`}
                            label={t("case.ownership.include_label", {
                              name: document.name,
                            })}
                            defaultChecked={scope.include ?? true}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {docs.length > VISIBLE_DOCS ? (
              <button
                type="button"
                className="ghost task-toggle"
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll
                  ? t("common.collapse")
                  : t("case.ownership.expand_docs", { count: docs.length })}
              </button>
            ) : null}
          </div>

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
