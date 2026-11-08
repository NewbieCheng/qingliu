import React from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { formatCents, formatDateTime } from "@/shared/lib/format.js";
import { SOURCES } from "@/shared/lib/constants.js";
import { AIAnalysisPanel } from "@/features/ai-analysis/index.js";
import { reportDownloadURL } from "../../api.js";

const DOWNLOADS = [
  ["report.pdf", "PDF"],
  ["summary.xlsx", "汇总Excel"],
  ["detail.xlsx", "逐笔底稿"],
  ["report.html", "网页快照"],
];

function ReportNumbers({ summary }) {
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
              {summary.complete_month_average == null ? "无完整自然月" : "元"}
            </small>
          </strong>
          <p>只统计范围内 {summary.complete_month_count} 个完整自然月。</p>
        </div>
      </div>
      <details>
        <summary>查看月度与季度结息</summary>
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
        {Object.entries(summary.quarters).map(([quarter, interest]) => (
          <p key={quarter}>
            {quarter} 存款结息：
            {interest == null
              ? "未找到结息记录，非实际零利息"
              : `${formatCents(interest)} 元（不计经营收入）`}
          </p>
        ))}
      </details>
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
      <div className="actions">
        <Form success="" onSave={() => onGenerate({ stage: "draft" })}>
          <button disabled={data.busy || !data.source}>生成草稿报告</button>
        </Form>
        <Form success="" onSave={() => onSubmit({})}>
          <button
            className="primary"
            disabled={data.busy || data.problems.length > 0}
          >
            提交复核
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
          <Field label="复核声明">
            <textarea
              name="statement"
              required
              placeholder="填写原件核对与签发依据"
            />
          </Field>
          <label className="check">
            <input type="checkbox" name="attest" required />
            确认当前版本已核对，理解该报告不代表授信审批
          </label>
          <button
            className="primary"
            disabled={
              data.busy || !data.submitted_current || data.problems.length > 0
            }
          >
            签发正式内部初筛版本
          </button>
        </Form>
      )}
    </section>
  );
}

function ReportVersions({ cid, data }) {
  return (
    <section className="card">
      <h2>已保存的报告版本</h2>
      {data.reports.length === 0 && (
        <p className="muted">
          生成报告后，PDF、Excel与网页快照会保存在这里。
        </p>
      )}
      {data.reports.map((report) => (
        <div className="report-item" key={report.id}>
          <div>
            <strong>
              {report.info.stage === "formal"
                ? "正式内部初筛版本"
                : "草稿 · 未完成复核"}
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
            {DOWNLOADS.map(([file, label]) => (
              <a href={reportDownloadURL(cid, report.id, file)} key={file}>
                {label} ↓
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function ReportStep({ cid, data, user, summary, onGenerate, onSubmit, onFormal }) {
  return (
    <>
      <AIAnalysisPanel cid={cid} />
      <ReportNumbers summary={summary} />
      <SubmitPanel
        data={data}
        user={user}
        onGenerate={onGenerate}
        onSubmit={onSubmit}
        onFormal={onFormal}
      />
      <ReportVersions cid={cid} data={data} />
    </>
  );
}
