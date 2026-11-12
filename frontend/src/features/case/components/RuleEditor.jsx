import React, { useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { TrashIcon } from "@/shared/ui/icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

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
    <FoldPanel
      className="card fold-panel--card rule-editor-panel"
      title={t("case.rules.title")}
      badge={
        related.length > 0 ? (
          <em className="fold-panel-badge">{related.length}/50</em>
        ) : null
      }
    >
      <p className="muted rule-editor-hint">
        {t("case.rules.hint")}
      </p>
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
        <section className="rule-section">
          <div className="rule-section-head">
            {t("case.rules.related_people")}
            <button
              type="button"
              className="ghost rule-add"
              disabled={related.length >= 50}
              onClick={() =>
                setRelated([
                  ...related,
                  { name: "", account: "", mode: "pending" },
                ])
              }
            >
              {t("case.rules.add_related_person")}
            </button>
          </div>
          {related.length === 0 ? (
            <p className="muted rule-empty">{t("case.rules.related_empty")}</p>
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
                    aria-label={t("case.rules.remove_related_person", { index: index + 1 })}
                    title={t("common.remove")}
                    onClick={() =>
                      setRelated((rows) =>
                        rows.filter((_, current) => current !== index),
                      )
                    }
                  >
                    <TrashIcon size={16} />
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
                rows={3}
                defaultValue={rules.positive.join("，")}
              />
            </Field>
            <Field label={t("case.rules.negative_keywords")}>
              <textarea
                name="negative"
                rows={3}
                defaultValue={rules.negative.join("，")}
              />
            </Field>
          </div>
        </section>

        <div className="form-footer">
          <label className="check">
            <input
              type="checkbox"
              name="require_counterparty"
              defaultChecked={rules.require_counterparty}
            />
            {t("case.rules.require_counterparty_note")}
          </label>
          <div className="actions-end">
            <button className="primary" disabled={busy}>
              {t("case.rules.save")}
            </button>
          </div>
        </div>
      </Form>
    </FoldPanel>
  );
}
