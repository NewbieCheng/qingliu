import React, { useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import { UploadDropzone } from "@/shared/ui/UploadDropzone.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { SOURCES } from "@/shared/lib/constants.js";
import { DocumentList } from "../DocumentList.jsx";
import { runUploadWaterfall } from "../../lib/upload-waterfall.js";
import { useI18n } from "@/shared/i18n/index.jsx";

const SOURCE_OPTIONS = Object.entries(SOURCES).map(([value, label]) => ({
  value,
  label,
}));

export function UploadStep({ data, onUpload, onCommitParsed, onNext }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(null);

  return (
    <section className="card">
      <SectionTitle
        title={t("upload.title")}
        description={t("upload.desc")}
      />
      <Form
        success=""
        onSave={async (form) => {
          setProgress({ copy: t("upload.preparing") });
          try {
            const result = await runUploadWaterfall({
              form,
              uploadOriginal: onUpload,
              commitParsed: onCommitParsed,
              onProgress: setProgress,
            });
            if (result.boostedCount > 0) {
              toast(t("upload.submitted"));
            } else if (result.parsedCount > 0) {
              toast(t("upload.parse_complete"));
            }
          } catch (requestError) {
            toast(requestError.message || "Parse failed. Please try again later.", "error");
            throw requestError;
          } finally {
            setProgress(null);
          }
        }}
      >
        <div className="field field-compact">
          <span>Source</span>
          <SegmentedControl
            name="source"
            aria-label="Source"
            defaultValue="other"
            options={SOURCE_OPTIONS}
          />
        </div>
        <UploadDropzone name="files" disabled={data.busy || Boolean(progress)} />
        {progress?.copy ? (
          <p className="muted" role="status" aria-live="polite">
            {progress.copy}
          </p>
        ) : null}
        <div className="form-footer">
          <label className="check">
            <input type="checkbox" name="ocr" value="true" />
            Try local OCR for scanned credit reports (candidates still need manual check)
          </label>
          <div className="actions-end">
            <button type="button" className="ghost" onClick={onNext}>
              Next: confirm ownership →
            </button>
            <button className="primary" disabled={data.busy || Boolean(progress)}>
              Upload and start recognition
            </button>
          </div>
        </div>
      </Form>
      <DocumentList data={data} />
    </section>
  );
}
