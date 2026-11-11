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

const DOWNLOADS = [
  ["report.pdf", "PDF"],
  ["summary.xlsx", "汇总Excel"],
  ["detail.xlsx", "Line-by-line draft"],
  ["report.html", "Web snapshot"],
];

const VISIBLE_QUARTERS = 4;

function ReportNumbers({ summary }) {
  const [showAllQuarters, setShowAllQuarters] = useState(false);
  const quarterEntries = Object.entries(summary.quarters);
  const visibleQuarters = showAllQuarters
    ? quarterEntries
    : quarterEntries.slice(0, VISIBLE_QUARTERS);
  return (
    <section className="card">
      <h2>测算口径</h2>
      <div className="grid2 report-numbers">
        <div>
          <span>期间分摊月均</span>
          <strong>
            {formatCents(summary.average)} <small>元</small>
          </strong>
          <p>按选择范围涉及的 {summary.month_count} 个月分摊，不年化。</p>
        </div>
        <div>
          <span>完整自然月均</span>
          <strong>
            {formatCents(summary.complete_month_average)}{" "}
            <small>
              {summary.complete_month_average == null ? "No full calendar month" : "元"}
            </small>
          </strong>
          <p>只统计范围内 {summary.complete_month_count} 个完整自然月。</p>
        </div>
      </div>
      <FoldPanel title="查看月度与季度结息" className="report-interest">
        <table>
          <thead>
            <tr>
              <th>月份</th>
              <th>总流入（元）</th>
              <th>暂计经营（元）</th>
              <th>待核实（元）</th>
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
            {quarter} 存款结息：
            {interest == null
              ? "未找到结息记录，非实际零利息"
              : `${formatCents(interest)} 元（不计经营收入）`}
          </p>
        ))}
        {quarterEntries.length > VISIBLE_QUARTERS && (
          <button
            type="button"
            className="ghost task-toggle"
            onClick={() => setShowAllQuarters((value) => !value)}
          >
            {showAllQuarters ? "Collapse" : `展开全部 ${quarterEntries.length} 条`}
          </button>
        )}
      </FoldPanel>
    </section>
  );
}

function SubmitPanel({ data, user, onGenerate, onSubmit, onFormal }) {
  return (
    <section className="card">
      <h2>提交复核与生成报告</h2>
      {data.problems.length > 0 ? (
        <div className="notice">
          <strong>正式版本尚有未完成事项</strong>
          <ul>
            {data.problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="success">流程核对已完成，可以提交复核。</p>
      )}
      <div className="actions-end">
        <Form success="" onSave={() => onGenerate({ stage: "draft" })}>
          <button className="ghost" disabled={data.busy || !data.source}>
            生成草稿报告
          </button>
        </Form>
        <Form success="" onSave={() => onSubmit({})}>
          <button
            className="primary"
            disabled={data.busy || data.problems.length > 0}
          >
            Submit for review
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
          <Field label="Review statement">
            <textarea
              name="statement"
              required
              placeholder="填写原件核对与签发依据"
            />
          </Field>
          <div className="form-footer">
            <label className="check">
              <input type="checkbox" name="attest" required />
              确认当前版本已核对，理解该报告不代表授信审批
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
                签发正式内部初筛版本
              </button>
            </div>
          </div>
        </Form>
      )}
    </section>
  );
}

const VISIBLE_REPORTS = 3;

function ReportVersions({ cid, data }) {
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
        title: `网页快照 · ${formatDateTime(report.created)}`,
        html,
      });
    } catch (error) {
      setPreview({ open: false, title: "", html: "" });
      toast(error.message || "快照加载失败", "error");
    }
  }

  return (
    <section className="card">
      <h2>已保存的报告版本</h2>
      {data.reports.length === 0 && (
        <p className="muted">
          生成报告后，PDF、Excel与网页快照会保存在这里。
        </p>
      )}
      {visible.map((report) => (
        <div className="report-item" key={report.id}>
          <div>
            <strong>
              {report.info.stage === "formal"
                ? "正式内部初筛版本"
                : "Draft · review incomplete"}
            </strong>
            <small className="block">
              {formatDateTime(report.created)} · {SOURCES[report.info.source]} ·{" "}
              {report.info.start} 至 {report.info.end}
              {report.info.revision !== data.customer.revision
                ? " · 资料已有更新"
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
                  {label}预览
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
                  {downloading === `${report.id}/${file}` ? "下载中…" : label}
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
          {showAll ? "Collapse" : `展开全部 ${data.reports.length} 个版本`}
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
            <p className="muted">快照加载中…</p>
          )}
        </Modal>
      )}
    </section>
  );
}

export function ReportStep({ cid, data, user, summary, onGenerate, onSubmit, onFormal }) {
  return (
    <div className="report-layout">
      <section className="card ai-entry-card" aria-label="AI analysis">
        <AIAnalysisPanel cid={cid} docs={data.docs || []} />
      </section>
      <ReportNumbers summary={summary} />
      <SubmitPanel
        data={data}
        user={user}
        onGenerate={onGenerate}
        onSubmit={onSubmit}
        onFormal={onFormal}
      />
      <ReportVersions cid={cid} data={data} />
    </div>
  );
}
