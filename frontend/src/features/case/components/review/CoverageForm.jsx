import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";

export function CoverageForm({ data, onSave }) {
  const { t } = useI18n();
  return (
    <section className="card coverage-card">
      <h2>{t("case.coverage.title")}</h2>
      <p className="muted coverage-lead">
        {t("case.coverage.current_range", { source: SOURCES[data.source], start: data.start, end: data.end })}
      </p>
      <Form
        onSave={async (form) => {
          await onSave({
            confirmed: form.has("confirmed"),
            note: form.get("note"),
          });
        }}
      >
        <Field label={t("case.coverage.note_label")}>
          <input name="note" defaultValue={data.fields.coverage_note || ""} />
        </Field>
        <div className="form-footer">
          <label className="check">
            <input type="checkbox" name="confirmed" required />
            {t("case.coverage.confirm_checkbox")}
          </label>
          <div className="actions-end">
            <button className="primary" disabled={data.busy}>
              {t("case.coverage.continue_to_report")}
            </button>
          </div>
        </div>
      </Form>
    </section>
  );
}
