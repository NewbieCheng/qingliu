import React, { useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { Modal } from "@/shared/ui/Modal.jsx";
import { formatCents, formatDateTime } from "@/shared/lib/format.js";
import { SOURCES } from "@/shared/lib/constants.js";
import { DownloadIcon, EyeIcon } from "@/shared/ui/icons.jsx";
import { AIAnalysisPanel } from "@/features/ai-analysis/index.js";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { downloadReport, previewReport } from "../../api.js";
import { useI18n } from "@/shared/i18n/index.jsx";

const DOWNLOADS = [
  ["report.pdf", "PDF"],
  ["summary.xlsx", "case.report.summary_excel"],
  ["detail.xlsx", "Line-by-line draft"],
  ["report.html", "Web snapshot"],
];

const VISIBLE_QUARTERS = 4;

function ReportNumbers({ summary, t }) {
  const [showAllQuarters, setShowAllQuarters] = useState(false);
  const quarterEntries = Object.entries(summary.quarters);
  const visibleQuarters = showAllQuarters
    ? quarterEntries
    : quarterEntries.slice(0, VISIBLE_QUARTERS);
  return (
    <section className="card">
      <h2>{t("case.report.calculation_basis")}</h2>
      <div className="grid2 report-numbers">
        <div>
          <span>{t("case.report.period_average")}</span>
          <strong>
            {formatCents(summary.average)} <small>{t("summary.yuan")}</small>
          </strong>
          <p>{t("case.report.average_months", { count: summary.month_count })}</p>
        </div>
        <div>
          <span>{t("case.report.complete_month_average")}</span>
          <strong>
            {formatCents(summary.complete_month_average)}{" "}
            <small>
              {summary.complete_month_average == null ? t("case.report.no_full_month") : t("summary.yuan")}
            </small>
          </strong>
          <p>{t("case.report.complete_months", { count: summary.complete_month_count })}</p>
        </div>
      </div>
      <FoldPanel title={t("case.report.interest_panel_title")} className="report-interest">
        <table>
          <thead>
            <tr>
              <th>{t("case.report.month")}</th>
              <th>{t("case.report.total_inflow_yuan")}</th>
              <th>{t("case.report.tentative_business_yuan")}</th>
              <th>{t("case.report.pending_yuan")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.monthly.map((month) => (
              <tr key={month.month}>
                <td>{month.month}</td>
                <td>{formatCents(month.income)}</td>
                <td>{formatCents(month.included)}</td>
                <td>{formatCents(month.pending)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleQuarters.map(([quarter, interest]) => (
          <p key={quarter}>
            {t("case.report.quarter_interest", { quarter })}
            {interest == null
              ? t("case.report.interest_not_found")
              : t("case.report.interest_amount", { amount: formatCents(interest) })}
          </p>
        ))}
        {quarterEntries.length > VISIBLE_QUARTERS && (
          <button
            type="button"
            className="ghost task-toggle"
            onClick={() => setShowAllQuarters((value) => !value)}
          >
            {showAllQuarters ? t("common.collapse") : t("case.report.show_quarters", { count: quarterEntries.length })}
          </button>
        )}
      </FoldPanel>
    </section>
  );
}

function SubmitPanel({ data, user, onGenerate, onSubmit, onFormal, t }) {
  return (
    <section className="card">
      <h2>{t("case.report.submit_generate_title")}</h2>
      {data.problems.length > 0 ? (
        <div className="notice">
          <strong>{t("case.report.formal_incomplete")}</strong>
          <ul>
            {data.problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="success">{t("case.report.ready_for_review")}</p>
      )}
      <div className="actions-end">
        <Form success="" onSave={() => onGenerate({ stage: "draft" })}>
          <button className="ghost" disabled={data.busy || !data.source}>
            {t("case.report.generate_draft")}
          </button>
        </Form>
        <Form success="" onSave={() => onSubmit({})}>
          <button
            className="primary"
            disabled={data.busy || data.problems.length > 0}
          >
            {t("case.report.submit_for_review")}
          </button>
        </Form>
      </div>
      {user.role !== "sales" && (
        <Form
          onSave={(form) =>
            onFormal({
              stage: "formal",
              statement: form.get("statement"),
              attest: form.has("attest"),
            })
          }
        >
          <Field label={t("case.report.review_statement")}>
            <textarea
              name="statement"
              required
              placeholder={t("case.report.review_statement_placeholder")}
            />
          </Field>
          <div className="form-footer">
            <label className="check">
              <input type="checkbox" name="attest" required />
              {t("case.report.formal_attestation")}
            </label>
            <div className="actions-end">
              <button
                className="primary"
                disabled={
                  data.busy ||
                  !data.submitted_current ||
                  data.problems.length > 0
                }
              >
                {t("case.report.issue_formal_version")}
              </button>
            </div>
          </div>
        </Form>
      )}
    </section>
  );
}

const VISIBLE_REPORTS = 3;

function ReportVersions({ cid, data, t }) {
  const [showAll, setShowAll] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [preview, setPreview] = useState({ open: false, title: "", html: "" });
  const visible = showAll ? data.reports : data.reports.slice(0, VISIBLE_REPORTS);

  async function onDownload(report, file) {
    const key = `${report.id}/${file}`;
    setDownloading(key);
    try {
      await downloadReport(cid, report.id, file);
    } catch (error) {
      toast(error.message || "Download failed. Please retry later.", "error");
    } finally {
      setDownloading("");
    }
  }

  async function onPreview(report) {
    setPreview({ open: true, title: "", html: "" });
    try {
      const html = await previewReport(cid, report.id);
      setPreview({
        open: true,
        title: t("case.report.web_snapshot_title", { date: formatDateTime(report.created) }),
        html,
      });
    } catch (error) {
      setPreview({ open: false, title: "", html: "" });
      toast(error.message || t("case.report.snapshot_load_failed"), "error");
    }
  }

  return (
    <section className="card">
      <h2>{t("case.report.saved_versions")}</h2>
      {data.reports.length === 0 && (
        <p className="muted">{t("case.report.saved_versions_empty")}</p>
      )}
      {visible.map((report) => (
        <div className="report-item" key={report.id}>
          <div>
            <strong>
              {report.info.stage === "formal"
                ? t("case.report.formal_version")
                : t("case.report.draft_version")}
            </strong>
            <small className="block">
              {formatDateTime(report.created)} · {SOURCES[report.info.source]} ·{" "}
              {report.info.start} – {report.info.end}
              {report.info.revision !== data.customer.revision
                ? ` · ${t("case.report.data_updated")}`
                : ""}
            </small>
          </div>
          <div className="downloads">
            {DOWNLOADS.map(([file, label]) =>
              file === "report.html" ? (
                <button
                  key={file}
                  type="button"
                  className="ghost download-btn"
                  onClick={() => void onPreview(report)}
                >
                  <EyeIcon size={13} />
                  {t("case.report.preview", { label: t(label) })}
                </button>
              ) : (
                <button
                  key={file}
                  type="button"
                  className="ghost download-btn"
                  disabled={downloading === `${report.id}/${file}`}
                  onClick={() => void onDownload(report, file)}
                >
                  <DownloadIcon size={13} />
                  {downloading === `${report.id}/${file}` ? t("case.report.downloading") : t(label)}
                </button>
              ),
            )}
          </div>
        </div>
      ))}
      {data.reports.length > VISIBLE_REPORTS && (
        <button
          type="button"
          className="ghost task-toggle"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? t("common.collapse") : t("case.report.show_versions", { count: data.reports.length })}
        </button>
      )}
      {preview.open && (
        <Modal
          title={preview.title || "Web snapshot"}
          onClose={() => setPreview({ open: false, title: "", html: "" })}
        >
          {preview.html ? (
            <iframe
              className="preview-frame"
              title={preview.title}
              sandbox=""
              srcDoc={preview.html}
            />
          ) : (
            <p className="muted">{t("case.report.snapshot_loading")}</p>
          )}
        </Modal>
      )}
    </section>
  );
}

export function ReportStep({ cid, data, user, summary, onGenerate, onSubmit, onFormal }) {
  const { t } = useI18n();
  return (
    <div className="report-layout">
      <section className="card ai-entry-card" aria-label="AI analysis">
        <AIAnalysisPanel cid={cid} docs={data.docs || []} />
      </section>
      <ReportNumbers summary={summary} t={t} />
      <SubmitPanel
        data={data}
        user={user}
        onGenerate={onGenerate}
        onSubmit={onSubmit}
        onFormal={onFormal}
        t={t}
      />
      <ReportVersions cid={cid} data={data} t={t} />
    </div>
  );
}
