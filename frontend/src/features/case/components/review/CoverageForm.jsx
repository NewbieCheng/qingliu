import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { SOURCES } from "@/shared/lib/constants.js";

export function CoverageForm({ data, onSave }) {
  return (
    <section className="card">
      <h2>确认统计期间与完整性</h2>
      <p className="muted">
        当前：{SOURCES[data.source]}，{data.start} 至 {data.end}
        。请核对原件声明期间、缺页及完整性，不能仅凭有交易的月份推断覆盖。
      </p>
      <Form
        onSave={async (form) => {
          await onSave({
            confirmed: form.has("confirmed"),
            note: form.get("note"),
          });
        }}
      >
        <Field label="核对说明">
          <input name="note" defaultValue={data.fields.coverage_note || ""} />
        </Field>
        <label className="check">
          <input type="checkbox" name="confirmed" required />
          我已对照原件核对当前范围与完整性
        </label>
        <button className="primary" disabled={data.busy}>
          确认期间，查看报告
        </button>
      </Form>
    </section>
  );
}
