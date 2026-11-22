import React, { useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { PlusIcon, TrashIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

/**
 * 核对规则表单本体。由父级用二级浮层挂出，不再单独占一块 FoldPanel。
 */
export function RuleEditor({ rules, busy, onSave }) {
  const { t } = useI18n();
  const [related, setRelated] = useState(rules.related || []);

  function updatePerson(index, patch) {
    setRelated((rows) =>
      rows.map((row, current) =>
        current === index ? { ...row, ...patch } : row,
      ),
    );
  }

  return (
    <div className="rule-editor-panel">
      <header className="ql-secondary-pop-head">
        <strong className="ql-secondary-pop-title">{t("case.rules.title")}</strong>
        <p className="ql-secondary-pop-hint">{t("case.rules.hint")}</p>
      </header>
      <Form
        className="rule-editor-form"
        onSave={(form) =>
          onSave({
            ...rules,
            related,
            require_counterparty: form.has("require_counterparty"),
            positive: String(form.get("positive"))
              .split(/[，,\n]/)
              .map((value) => value.trim())
              .filter(Boolean),
            negative: String(form.get("negative"))
              .split(/[，,\n]/)
              .map((value) => value.trim())
              .filter(Boolean),
          })
        }
      >
        <div className="ql-secondary-pop-body">
          <section className="rule-section">
            <div className="rule-section-head">
              <strong>{t("case.rules.related_people")}</strong>
              <button
                type="button"
                className="btn-outline btn-compact rule-add"
                disabled={related.length >= 50}
                onClick={() =>
                  setRelated([
                    ...related,
                    { name: "", account: "", mode: "pending" },
                  ])
                }
              >
                <PlusIcon size={12} />
                {t("case.rules.add_related_person")}
              </button>
            </div>
            {related.length === 0 ? (
              <p className="rule-empty">{t("case.rules.related_empty")}</p>
            ) : (
              <div className="relation-list">
                <div className="relation relation-head" aria-hidden="true">
                  <span>{t("case.rules.name")}</span>
                  <span>{t("case.rules.account_optional")}</span>
                  <span>{t("case.rules.action")}</span>
                  <span />
                </div>
                {related.map((person, index) => (
                  <div className="relation" key={index}>
                    <input
                      aria-label={t("case.rules.related_name")}
                      placeholder={t("case.rules.full_name")}
                      value={person.name}
                      onChange={(event) =>
                        updatePerson(index, { name: event.target.value })
                      }
                    />
                    <input
                      aria-label={t("case.rules.related_account")}
                      placeholder={t("case.rules.full_account")}
                      value={person.account}
                      onChange={(event) =>
                        updatePerson(index, { account: event.target.value })
                      }
                    />
                    <Select
                      aria-label={t("case.rules.handling")}
                      label={t("case.rules.handling")}
                      className="relation-mode"
                      value={person.mode}
                      onChange={(event) =>
                        updatePerson(index, { mode: event.target.value })
                      }
                    >
                      <option value="pending">{t("case.rules.pending")}</option>
                      <option value="excluded">{t("case.rules.exclude")}</option>
                    </Select>
                    <button
                      type="button"
                      className="ghost relation-remove"
                      aria-label={t("case.rules.remove_related_person", {
                        index: index + 1,
                      })}
                      title={t("common.remove")}
                      onClick={() =>
                        setRelated((rows) =>
                          rows.filter((_, current) => current !== index),
                        )
                      }
                    >
                      <TrashIcon size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rule-section">
            <div className="rule-section-head">
              <strong>{t("case.rules.keywords")}</strong>
            </div>
            <div className="grid2 rule-keywords">
              <Field label={t("case.rules.positive_keywords")}>
                <textarea
                  name="positive"
                  rows={2}
                  defaultValue={rules.positive.join("，")}
                />
              </Field>
              <Field label={t("case.rules.negative_keywords")}>
                <textarea
                  name="negative"
                  rows={2}
                  defaultValue={rules.negative.join("，")}
                />
              </Field>
            </div>
          </section>
        </div>

        <div className="form-footer rule-footer ql-secondary-pop-foot">
          <label className="check">
            <input
              type="checkbox"
              name="require_counterparty"
              defaultChecked={rules.require_counterparty}
            />
            {t("case.rules.require_counterparty_note")}
          </label>
          <div className="actions-end">
            <button className="primary btn-compact" disabled={busy}>
              {t("case.rules.save")}
            </button>
          </div>
        </div>
      </Form>
    </div>
  );
}
