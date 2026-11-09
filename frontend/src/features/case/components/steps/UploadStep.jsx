import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { UploadDropzone } from "@/shared/ui/UploadDropzone.jsx";
import { SOURCES } from "@/shared/lib/constants.js";
import { DocumentList } from "../DocumentList.jsx";

export function UploadStep({ data, onUpload, onNext }) {
  return (
    <section className="card">
      <SectionTitle
        title="上传客户资料"
        description="PDF、CSV 或 XLSX；每批最多10份，单份30MB，整批60MB。PDF最多500页。上传后可在任务列表查看解析进度。"
      />
      <Form onSave={async (form) => onUpload(form)}>
        <Field label="资料来源">
          <Select name="source" label="资料来源" defaultValue="other">
            {Object.entries(SOURCES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <UploadDropzone name="files" disabled={data.busy} />
        <label className="check">
          <input type="checkbox" name="ocr" value="true" />
          扫描征信尝试本地识别（候选文字仍须人工核对）
        </label>
        <div className="actions-end">
          <button type="button" className="ghost" onClick={onNext}>
            下一步：确认归属 →
          </button>
          <button className="primary" disabled={data.busy}>
            上传并开始识别
          </button>
        </div>
      </Form>
      <DocumentList data={data} />
    </section>
  );
}
