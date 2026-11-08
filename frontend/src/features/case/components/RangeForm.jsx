import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { SOURCES } from "@/shared/lib/constants.js";

export function RangeForm({ data, onChange }) {
  return (
    <Form
      className="card range"
      onSave={(form) => onChange(Object.fromEntries(form))}
      key={data.start + data.end + data.source}
    >
      <Field label="统计来源">
        <select name="source" defaultValue={data.source}>
          {data.choices.map((value) => (
            <option key={value} value={value}>
              {SOURCES[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="开始日期">
        <input name="start" type="date" defaultValue={data.start} required />
      </Field>
      <Field label="截止日期">
        <input name="end" type="date" defaultValue={data.end} required />
      </Field>
      <button>切换统计范围</button>
    </Form>
  );
}
