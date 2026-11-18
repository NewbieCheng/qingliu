import React, { useMemo, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { formatDateTime } from "@/shared/lib/format.js";
import { Modal } from "@/shared/ui/Modal.jsx";
import {
  enrichAIResult,
  formatAISummary,
  formatPageLabel,
  splitSummaryBlocks,
} from "./format-result.js";

function formatDetailAmount(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    return value
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join("、");
  }
  return String(value).trim();
}

function pageKey(row) {
  return formatPageLabel(row?.page) || String(row?.page || "").trim() || "";
}

function coverageOf(result) {
  const coverage = result?.coverage;
  if (coverage && typeof coverage === "object") {
    return {
      pagesAnalyzed: Number(coverage.pages_analyzed) || 0,
      pagesTotal: Number(coverage.pages_total) || 0,
      chunks: Number(coverage.chunks) || 0,
    };
  }
  return { pagesAnalyzed: 0, pagesTotal: 0, chunks: 0 };
}

/**
 * 终态分析报告：结构对齐参考稿（hero / stats / 摘要 / 异常筛选 / 收入表 / 问题 / 时间线），
 * 视觉走清流 forest·copper·paper，不做蓝调 SaaS 翻版。
 */
export function AIReportDialog({ open, onClose, analysis, onCopy, onExport }) {
  const { t } = useI18n();
  const [pageFilter, setPageFilter] = useState("all");
  const [theme, setTheme] = useState("light");

  const result = useMemo(
    () => (analysis?.result ? enrichAIResult(analysis.result) : null),
    [analysis],
  );

  if (!open || !analysis || !result) return null;

  const summaryText = formatAISummary(result) || result.summary || "";
  const summaryBlocks = splitSummaryBlocks(summaryText);
  const anomalies = Array.isArray(result.anomalies) ? result.anomalies : [];
  const income = Array.isArray(result.income_structure) ? result.income_structure : [];
  const questions = Array.isArray(result.questions) ? result.questions : [];
  const process = Array.isArray(result.process) ? result.process : [];
  const coverage = coverageOf(result);
  const pageOptions = [
    "all",
    ...new Set(anomalies.map((row) => pageKey(row)).filter(Boolean)),
  ];
  const filteredAnomalies =
    pageFilter === "all"
      ? anomalies
      : anomalies.filter((row) => pageKey(row) === pageFilter);

  const completedAt = analysis.completed || analysis.created;
  const wbId = analysis.workbench_analysis_id;
  const pagesLabel =
    coverage.pagesTotal > 0
      ? `${coverage.pagesAnalyzed || coverage.pagesTotal} / ${coverage.pagesTotal}`
      : "—";

  return (
    <Modal
      title={t("ai.report_title")}
      onClose={onClose}
      className="ai-report-dialog"
    >
      <div className="ai-report" data-theme={theme}>
        <header className="ai-report-hero">
          <div className="ai-report-hero-main">
            <p className="ai-report-kicker">{t("ai.report_title")}</p>
            <div className="ai-report-meta">
              {analysis.customer_id ? (
                <span>
                  {t("ai.report_customer")}: {analysis.customer_id}
                </span>
              ) : null}
              {analysis.document_id ? (
                <span>
                  {t("ai.report_document")}: {analysis.document_id}
                </span>
              ) : null}
            </div>
            <div className="ai-report-chips">
              {completedAt ? (
                <span className="ai-report-chip">
                  {t("ai.report_completed_at", {
                    time: formatDateTime(completedAt),
                  })}
                </span>
              ) : null}
              {wbId ? (
                <span className="ai-report-chip">
                  {t("ai.report_workbench", { id: wbId })}
                </span>
              ) : null}
              {coverage.pagesTotal > 0 ? (
                <span className="ai-report-chip">
                  {t("ai.report_coverage", {
                    analyzed: coverage.pagesAnalyzed || coverage.pagesTotal,
                    total: coverage.pagesTotal,
                  })}
                </span>
              ) : null}
            </div>
          </div>
          <span className="ai-report-badge">{t("ai.status_done")}</span>
        </header>

        <section className="ai-report-stats" aria-label={t("ai.report_title")}>
          <div className="ai-report-stat">
            <div className="ai-report-stat-num">{pagesLabel}</div>
            <div className="ai-report-stat-lbl">{t("ai.report_stat_pages")}</div>
          </div>
          <div className="ai-report-stat">
            <div className="ai-report-stat-num">
              {coverage.chunks || summaryBlocks.length || "—"}
            </div>
            <div className="ai-report-stat-lbl">{t("ai.report_stat_chunks")}</div>
          </div>
          <div className="ai-report-stat">
            <div className="ai-report-stat-num">{anomalies.length}</div>
            <div className="ai-report-stat-lbl">{t("ai.report_stat_anomalies")}</div>
          </div>
          <div className="ai-report-stat">
            <div className="ai-report-stat-num">{questions.length}</div>
            <div className="ai-report-stat-lbl">{t("ai.report_stat_questions")}</div>
          </div>
          <div className="ai-report-stat">
            <div className="ai-report-stat-num">{income.length}</div>
            <div className="ai-report-stat-lbl">{t("ai.report_stat_income")}</div>
          </div>
        </section>

        <div className="ai-report-toolbar">
          <button type="button" className="btn-chip" onClick={onCopy}>
            {t("common.copy")}
          </button>
          <button type="button" className="btn-chip" onClick={onExport}>
            {t("common.export")}
          </button>
        </div>

        {summaryBlocks.length ? (
          <section className="ai-report-card">
            <h3>{t("ai.report_summary")}</h3>
            <div className="ai-report-summary">
              {summaryBlocks.map((block, index) => (
                <div className="ai-report-sum-item" key={`${block.scope}-${index}`}>
                  {block.scope ? (
                    <span className="ai-report-page-tag">{block.scope}</span>
                  ) : null}
                  <p>{block.text}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {anomalies.length ? (
          <section className="ai-report-card">
            <h3>
              {t("ai.report_anomalies")}
              <span className="ai-report-count">{anomalies.length}</span>
            </h3>
            <div className="ai-report-filters" role="tablist">
              {pageOptions.map((page) => {
                const active = pageFilter === page;
                const label =
                  page === "all" ? t("ai.report_filter_all") : page;
                return (
                  <button
                    key={page}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`ai-report-filter${active ? " is-active" : ""}`}
                    onClick={() => setPageFilter(page)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="ai-report-anomaly-list">
              {filteredAnomalies.map((row, index) => {
                const title = row?.item || row?.label || "—";
                const page = pageKey(row);
                const evidence = String(row?.evidence || row?.locator || "").trim();
                return (
                  <article className="ai-report-anomaly" key={`${page}-${index}`}>
                    <div className="ai-report-anomaly-head">
                      {page ? (
                        <span className="ai-report-page-tag">{page}</span>
                      ) : null}
                      <h4>{title}</h4>
                    </div>
                    {evidence ? (
                      <p className="ai-report-evidence">
                        <b>{t("ai.report_evidence")}</b>
                        {evidence}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {income.length ? (
          <section className="ai-report-card">
            <h3>{t("ai.report_income")}</h3>
            <div className="ai-report-table-wrap">
              <table className="ai-report-table">
                <thead>
                  <tr>
                    <th>{t("ai.report_col_source")}</th>
                    <th>{t("ai.report_col_amount")}</th>
                    <th>{t("ai.report_col_evidence")}</th>
                    <th>{t("ai.report_col_page")}</th>
                  </tr>
                </thead>
                <tbody>
                  {income.map((row, index) => (
                    <tr key={index}>
                      <td>{row?.source || row?.item || "—"}</td>
                      <td className="ai-report-amount">
                        {formatDetailAmount(row?.amount) || "—"}
                      </td>
                      <td className="ai-report-note">
                        {String(row?.evidence || row?.locator || "").trim() ||
                          "—"}
                      </td>
                      <td>
                        {pageKey(row) ? (
                          <span className="ai-report-page-tag">{pageKey(row)}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {questions.length ? (
          <section className="ai-report-card">
            <h3>
              {t("ai.report_questions")}
              <span className="ai-report-count">{questions.length}</span>
            </h3>
            <ol className="ai-report-qlist">
              {questions.map((row, index) => {
                const text =
                  typeof row === "string"
                    ? row
                    : row?.item || row?.label || "";
                const page = typeof row === "object" ? pageKey(row) : "";
                return (
                  <li key={index}>
                    {text}
                    {page ? <span className="ai-report-q-page">{page}</span> : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {(process.length > 0 || analysis.status) && (
          <section className="ai-report-card">
            <h3>{t("ai.report_timeline")}</h3>
            <ul className="ai-report-timeline">
              <li className={analysis.status === "done" ? "is-ok" : "is-fail"}>
                <div className="ai-report-t-title">
                  {t(STATUS_LABEL[analysis.status] || "ai.status_done")}
                  <span
                    className={`ai-report-tag ${
                      analysis.status === "done" ? "is-ok" : "is-fail"
                    }`}
                  >
                    {analysis.status === "done"
                      ? t("ai.report_tag_ok")
                      : t("ai.report_tag_fail")}
                  </span>
                </div>
                <div className="ai-report-t-meta">
                  {completedAt ? formatDateTime(completedAt) : ""}
                  {wbId ? ` · workbench #${wbId}` : ""}
                  {analysis.progress != null ? ` · ${analysis.progress}%` : ""}
                </div>
              </li>
              {process.slice(-8).reverse().map((line, index) => (
                <li key={`${index}-${String(line).slice(0, 16)}`}>
                  <div className="ai-report-t-title">{line}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {result.disclaimer ? (
          <p className="ai-report-disclaimer">{result.disclaimer}</p>
        ) : (
          <p className="ai-report-disclaimer">{t("ai.report_disclaimer")}</p>
        )}

        <div className="ai-report-theme-dock">
          <span className="ai-report-theme-label">{t("ai.report_night")}</span>
          <button
            type="button"
            className="ai-report-switch"
            role="switch"
            aria-checked={theme === "dark"}
            aria-label={t("ai.report_night")}
            onClick={() =>
              setTheme((value) => (value === "dark" ? "light" : "dark"))
            }
          >
            <span className="ai-report-knob" />
          </button>
        </div>
      </div>
    </Modal>
  );
}

const STATUS_LABEL = {
  done: "ai.status_done",
  failed: "ai.status_failed",
  running: "ai.status_running",
  queued: "ai.status_queued",
  uploading: "ai.status_uploading",
};
