import React from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { useI18n } from "@/shared/i18n/index.jsx";

/**
 * 核对末步：确认「这次测算覆盖的流水期间/资料」无误后进入报告。
 * 仍放在交易表下方，避免和顶栏日期筛选混淆（筛选改范围；这里是签字式确认）。
 */
export function CoverageForm({ data, onSave }) {
  const { t } = useI18n();
  const sourceLabel = SOURCES[data.source]
    ? t(SOURCES[data.source])
    : data.source;

  return (
    <section className="card coverage-card">
      <header className="coverage-head">
        <div className="coverage-head-copy">
          <h2>{t("case.coverage.title")}</h2>
          <p className="muted coverage-lead">
            {t("case.coverage.current_range", {
              source: sourceLabel,
              start: data.start,
              end: data.end,
            })}
          </p>
        </div>
        <p className="muted coverage-how">{t("case.coverage.how_to")}</p>
      </header>
      <Form
        className="coverage-form"
        onSave={async (form) => {
          await onSave({
            confirmed: form.has("confirmed"),
            note: form.get("note"),
          });
        }}
      >
        <div className="coverage-row">
          <label className="coverage-note-inline">
            <span>{t("case.coverage.note_label")}</span>
            <input
              name="note"
              defaultValue={data.fields.coverage_note || ""}
              placeholder={t("case.coverage.note_placeholder")}
              autoComplete="off"
            />
          </label>
          <label className="check coverage-confirm">
            <input type="checkbox" name="confirmed" required />
            {t("case.coverage.confirm_checkbox")}
          </label>
          <button className="primary btn-compact" disabled={data.busy}>
            {t("case.coverage.continue_to_report")}
          </button>
        </div>
      </Form>
    </section>
  );
}
