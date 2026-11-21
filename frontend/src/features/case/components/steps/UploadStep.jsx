import React, { useMemo, useState } from "react";
import { Form } from "@/shared/ui/Form.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import { UploadDropzone } from "@/shared/ui/UploadDropzone.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { SOURCES } from "@/shared/lib/constants.js";
import { ParseRecordsPanel } from "../ParseRecordsPanel.jsx";
import { runUploadWaterfall } from "../../lib/upload-waterfall.js";
import { useI18n } from "@/shared/i18n/index.jsx";

export function UploadStep({ data, onUpload, onCommitParsed, onReparsed, onNext }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState(null);
  const sourceOptions = useMemo(
    () =>
      Object.entries(SOURCES).map(([value, labelKey]) => ({
        value,
        label: t(labelKey),
      })),
    [t],
  );

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
            toast(requestError.message || t("upload.parse_failed"), "error");
            throw requestError;
          } finally {
            setProgress(null);
          }
        }}
      >
        <div className="field field-compact">
          <span>{t("upload.source_label")}</span>
          <SegmentedControl
            name="source"
            aria-label={t("upload.source_label")}
            defaultValue="other"
            options={sourceOptions}
          />
        </div>
        <UploadDropzone name="files" disabled={data.busy || Boolean(progress)} />
        {progress?.copy ? (
          <p className="muted" role="status" aria-live="polite">
            {progress.copy}
          </p>
        ) : null}
        <div className="form-footer">
          <div className="actions-end">
            <button type="button" className="btn-chip" onClick={onNext}>
              {t("upload.next_step")}
            </button>
            <button className="primary" disabled={data.busy || Boolean(progress)}>
              {t("upload.btn_start")}
            </button>
          </div>
        </div>
      </Form>
      <ParseRecordsPanel data={data} onReparsed={onReparsed} />
    </section>
  );
}
