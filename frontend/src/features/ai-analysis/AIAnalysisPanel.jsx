import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { navigate } from "@/shared/router/index.js";
import {
  invalidateAnalyses,
  queryAnalyses,
  queryBalance,
} from "@/app/queries/index.js";
import { availablePoints } from "@/features/billing/index.js";
import { isInsufficientPointsError } from "@/shared/lib/billing.js";
import {
  applyAISuggest,
  applyAIWriteback,
  startAnalysis,
} from "./api.js";
import { AIReportDialog } from "./AIReportDialog.jsx";
import {
  copyText,
  downloadText,
  enrichAIResult,
  formatAIExportText,
  formatAISummary,
  splitSummaryBlocks,
} from "./format-result.js";

const STATUS_KEY = {
  uploading: "ai.status_uploading",
  queued: "ai.status_queued",
  running: "ai.status_running",
  done: "ai.status_done",
  failed: "ai.status_failed",
};

const ETA_HINT_KEY = {
  analysis: "job.eta.ai_analysis",
  page_ocr: "job.eta.upload",
};

const AI_MODES = [
  {
    value: "analysis",
    labelKey: "ai.mode_analysis",
    hintKey: "ai.mode_analysis_hint",
  },
  {
    value: "page_ocr",
    labelKey: "ai.mode_ocr",
    hintKey: "ai.mode_ocr_hint",
  },
];

function isActiveStatus(status) {
  return ["uploading", "queued", "running"].includes(status);
}

function progressValue(item) {
  return Math.max(0, Math.min(100, Number(item?.progress) || 0));
}

/** 入口卡分态：进行中 > 最近成功 > 最近失败 > 未分析 */
function pickEntryState(items) {
  const list = Array.isArray(items) ? items : [];
  const running = list.find((item) => isActiveStatus(item.status));
  const latestDone = list.find((item) => item.status === "done");
  const latestFailed = list.find((item) => item.status === "failed");
  if (running) {
    return { mode: "running", current: running, latestDone, latestFailed };
  }
  if (latestDone) {
    return { mode: "done", current: latestDone, latestDone, latestFailed };
  }
  if (latestFailed) {
    return { mode: "failed", current: latestFailed, latestDone: null, latestFailed };
  }
  return { mode: "idle", current: null, latestDone: null, latestFailed: null };
}

async function handleCopyExport(result, action, t) {
  try {
    const text = formatAIExportText(result);
    if (action === "copy") {
      await copyText(text);
      toast(t("common.copy"), "success");
      return;
    }
    downloadText(`ai-analysis-${Date.now()}.txt`, text);
    toast(t("common.export"), "success");
  } catch (requestError) {
    toast(requestError.message || t("common.retry"), "error");
  }
}

function AIProcessLog({ process }) {
  const { t } = useI18n();
  if (!process?.length) return null;
  const visible = process.slice(-12);
  return (
    <div className="ai-process" aria-live="polite">
      <h3>{t("ai.process_title")}</h3>
      <ol>
        {visible.map((line, index) => (
          <li key={`${index}-${line.slice(0, 24)}`}>{line}</li>
        ))}
      </ol>
      {process.length > visible.length ? (
        <p className="muted">{t("ai.process_recent", { n: visible.length })}</p>
      ) : null}
    </div>
  );
}

function AISummaryBlocks({ summaryText, trailing = "" }) {
  const blocks = splitSummaryBlocks(summaryText);
  if (!blocks.length) return null;
  return (
    <div className="ai-summary-blocks">
      {blocks.map((block, index) => (
        <div className="ai-summary-block" key={`${block.scope}-${index}`}>
          {block.scope ? <span className="ai-page-pill">{block.scope}</span> : null}
          <p className="ai-summary">
            {block.text}
            {index === blocks.length - 1 ? trailing : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function AIResultActions({ result, disabled }) {
  const { t } = useI18n();
  if (!result || disabled) return null;
  const text = formatAIExportText(result);
  if (!text) return null;
  return (
    <div className="ai-result-actions">
      <button
        type="button"
        className="btn-chip"
        onClick={() => void handleCopyExport(result, "copy", t)}
      >
        {t("common.copy")}
      </button>
      <button
        type="button"
        className="btn-chip"
        onClick={() => void handleCopyExport(result, "export", t)}
      >
        {t("common.export")}
      </button>
    </div>
  );
}

function AIAnalysisDialog({
  cid,
  docs = [],
  onClose,
  intent = "start",
  focusAnalysisId = "",
  onViewReport,
}) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("analysis");
  const [documentId, setDocumentId] = useState(docs[0]?.id || "");
  const [points, setPoints] = useState(null);

  useEffect(() => {
    if (!docs.length) {
      setDocumentId("");
      return;
    }
    if (!docs.some((doc) => String(doc.id) === String(documentId))) {
      setDocumentId(docs[0].id);
    }
  }, [docs, documentId]);

  useEffect(() => {
    let alive = true;
    queryBalance()
      .then((data) => {
        if (alive) setPoints(availablePoints(data) ?? 0);
      })
      .catch(() => {
        if (alive) setPoints(null);
      });
    return () => {
      alive = false;
    };
  }, [cid]);

  const needRecharge = points !== null && Number(points) <= 0;

  async function load({ force = false } = {}) {
    try {
      const data = await queryAnalyses(cid, { force });
      setItems(data.items || []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    void load();
  }, [cid]);

  const latest = items[0];
  const running = latest && isActiveStatus(latest.status);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      void load({ force: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [running, latest?.id, latest?.status, cid]);

  async function start() {
    if (!documentId) {
      const message = docs.length ? t("ai.pick_doc") : t("ai.need_upload");
      setError(message);
      toast(message, "error");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await startAnalysis(cid, {
        documentId,
        task: mode === "page_ocr" ? mode : undefined,
      });
      toast(
        mode === "page_ocr" ? t("ai.start_ocr") : t("ai.start_analysis"),
        "info",
      );
      invalidateAnalyses(cid);
      await load({ force: true });
    } catch (requestError) {
      setError(requestError.message);
      if (isInsufficientPointsError(requestError)) setPoints(0);
      toast(requestError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function writeSuggest() {
    if (!latest?.id || latest.status !== "done") return;
    setBusy(true);
    try {
      const data = await applyAISuggest(cid, latest.id);
      const n = Number(data?.applied) || 0;
      toast(
        n > 0 ? t("ai.write_suggest") : t("ai.pick_doc"),
        n > 0 ? "success" : "info",
      );
    } catch (requestError) {
      toast(requestError.message || t("ai.write_suggest"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function writeOCRRows() {
    if (!latest?.id || latest.status !== "done") return;
    setBusy(true);
    try {
      const data = await applyAIWriteback(cid, latest.id);
      const n = Number(data?.rows) || 0;
      toast(
        n > 0
          ? t("case.review.adopt_ai_suggestions", { count: n })
          : t("ai.pick_doc"),
        n > 0 ? "success" : "info",
      );
    } catch (requestError) {
      toast(requestError.message || t("case.review.title"), "error");
    } finally {
      setBusy(false);
    }
  }

  const selectedDoc = docs.find((doc) => String(doc.id) === String(documentId));
  const canStart = Boolean(documentId) && !busy && !needRecharge;
  const percent = progressValue(latest);
  const displayResult = latest?.result ? enrichAIResult(latest.result) : null;
  const detailCount =
    (displayResult?.income_structure?.length || 0) +
    (displayResult?.anomalies?.length || 0) +
    (displayResult?.questions?.length || 0);
  const summaryText = displayResult
    ? formatAISummary(displayResult) || displayResult.summary || ""
    : "";
  const modeHint = t(
    AI_MODES.find((item) => item.value === mode)?.hintKey || AI_MODES[0].hintKey,
  );
  const eta = t(ETA_HINT_KEY[mode] || ETA_HINT_KEY.analysis);

  const focusItem =
    (focusAnalysisId &&
      items.find((item) => String(item.id) === String(focusAnalysisId))) ||
    items.find((item) => item.status === "done") ||
    latest;

  return (
    <Modal title={t("ai.title")} onClose={onClose} className="modal--sm">
      <div className="ai-dialog-body">
        <p className="muted" style={{ margin: 0 }}>
          {t("ai.panel_title")}
        </p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {needRecharge ? (
          <div className="billing-notice" role="status">
            <span>{t("ai.recharge_prompt_body")}</span>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                onClose();
                navigate("/recharge");
              }}
            >
              {t("ai.go_recharge")}
            </button>
          </div>
        ) : null}
        <label className="field">
          <span>{t("ai.pick_doc")}</span>
          {docs.length ? (
            <select
              value={documentId}
              onChange={(event) => setDocumentId(event.target.value)}
              disabled={busy || running}
              aria-label={t("ai.pick_doc")}
            >
              {docs.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name}
                  {doc.meta?.pages
                    ? ` · ${t("ai.doc_pages", { n: doc.meta.pages })}`
                    : ""}
                  {doc.meta?.rows
                    ? ` · ${t("ai.doc_rows", { n: doc.meta.rows })}`
                    : ""}
                </option>
              ))}
            </select>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {t("ai.need_upload")}
            </p>
          )}
          {selectedDoc ? (
            <p className="ai-mode-hint">{t("ai.mode_analysis_hint")}</p>
          ) : null}
        </label>
        <div>
          <SegmentedControl
            aria-label={t("ai.panel_title")}
            value={mode}
            onChange={setMode}
            options={AI_MODES.map((item) => ({
              ...item,
              label: t(item.labelKey),
            }))}
          />
          <p className="ai-mode-hint">
            {modeHint} · {eta}
          </p>
        </div>
        <ModalActions className="actions-end">
          <button
            type="button"
            className="ghost"
            onClick={() => void load({ force: true })}
          >
            {t("topbar.refresh")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canStart || running}
            onClick={() => void start()}
          >
            {busy
              ? t("ai.status_queued")
              : latest?.status === "done" || intent === "rerun"
                ? t("ai.btn_rerun")
                : t("ai.btn_start")}
          </button>
        </ModalActions>
        {latest ? (
          <div className="ai-result">
            <p className="muted">
              {t("ai.title")}:
              <StatusBadge
                tone={
                  latest.status === "done"
                    ? "default"
                    : latest.status === "failed"
                      ? "amber"
                      : "amber"
                }
              >
                {t(STATUS_KEY[latest.status] || "ai.status_failed")}
              </StatusBadge>
              {latest.error ? ` · ${latest.error}` : ""}
              {focusAnalysisId && String(latest.id) === String(focusAnalysisId)
                ? ` · ${t("ai.focused_result")}`
                : ""}
            </p>
            {running ? (
              <>
                <div
                  className="task-progress"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t("ai.panel_title")}
                >
                  <div
                    className="task-progress-bar"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="task-meta">
                  <span>
                    {latest.stage === "running"
                      ? t("ai.status_running")
                      : t(STATUS_KEY[latest.status] || "ai.status_running")}
                    {" · "}
                    {eta}
                  </span>
                  <span>{percent}%</span>
                </p>
              </>
            ) : null}
            <AIProcessLog process={displayResult?.process} />
            {summaryText ? (
              <AISummaryBlocks
                summaryText={summaryText}
                trailing={running && displayResult?.partial ? "…" : ""}
              />
            ) : latest.status === "done" ? (
              <p className="muted">{t("ai.status_done")}</p>
            ) : running ? (
              <p className="muted">{t("ai.status_running")}</p>
            ) : null}
            <div className="ai-result-actions ai-result-actions--stack">
              <AIResultActions result={displayResult} />
              {latest.status === "done" ? (
                <button
                  type="button"
                  className="btn-chip"
                  disabled={busy}
                  onClick={() => void writeSuggest()}
                >
                  {t("ai.write_suggest")}
                </button>
              ) : null}
              {latest.status === "done" && displayResult?.text ? (
                <button
                  type="button"
                  className="btn-chip"
                  disabled={busy}
                  onClick={() => void writeOCRRows()}
                >
                  {t("ai.write_ocr")}
                </button>
              ) : null}
              {detailCount > 0 ? (
                <button
                  type="button"
                  className="btn-chip is-ok"
                  onClick={() => onViewReport?.(focusItem || latest)}
                >
                  {t("ai.view_details", { n: detailCount })}
                </button>
              ) : null}
            </div>
            {displayResult?.disclaimer ? (
              <p className="muted">{displayResult.disclaimer}</p>
            ) : null}
          </div>
        ) : null}
        {items.length > 1 ? (
          <FoldPanel title={`${t("ai.panel_title")} (${items.length})`}>
            <ul>
              {items.slice(1).map((item) => (
                <li key={item.id}>
                  {formatDateTime(item.created)} ·{" "}
                  {t(STATUS_KEY[item.status] || "ai.status_failed")}
                </li>
              ))}
            </ul>
          </FoldPanel>
        ) : null}
      </div>
    </Modal>
  );
}

/** 报告页入口：按分析状态展示「查看报告 / 重新分析」，不再永远「开始分析」。 */
export function AIAnalysisPanel({ cid, docs = [] }) {
  const { t } = useI18n();
  const [setupOpen, setSetupOpen] = useState(false);
  const [intent, setIntent] = useState("start");
  const [focusAnalysisId, setFocusAnalysisId] = useState("");
  const [items, setItems] = useState([]);
  const [reportAnalysis, setReportAnalysis] = useState(null);

  async function refresh({ force = false } = {}) {
    try {
      const data = await queryAnalyses(cid, { force });
      setItems(data.items || []);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    queryAnalyses(cid)
      .then((data) => {
        if (!cancelled) setItems(data.items || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cid]);

  const entry = pickEntryState(items);
  const current = entry.current;
  const running = entry.mode === "running";
  const percent = progressValue(current);
  const eta = t(ETA_HINT_KEY.analysis);

  // 弹窗打开时由 Dialog 负责 force 轮询；入口卡仅在关闭且进行中时轮询。
  useEffect(() => {
    if (setupOpen) return undefined;
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      void refresh({ force: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [cid, setupOpen, running, current?.id, current?.status]);

  let statusLine = t("ai.entry_idle");
  if (entry.mode === "running") {
    statusLine = `${t("ai.status_running")} ${percent}% · ${eta}`;
  } else if (entry.mode === "done") {
    const when = current?.completed || current?.created;
    statusLine = when
      ? t("ai.entry_done", { time: formatDateTime(when) })
      : t("ai.status_done");
  } else if (entry.mode === "failed") {
    statusLine = current?.error
      ? t("ai.entry_failed", { error: current.error })
      : t("ai.status_failed");
  }

  function openSetup(nextIntent, analysisId = "") {
    setIntent(nextIntent);
    setFocusAnalysisId(analysisId || "");
    setSetupOpen(true);
  }

  function openReport(analysis) {
    if (!analysis?.result) {
      openSetup("view", analysis?.id);
      return;
    }
    setReportAnalysis(analysis);
  }

  const reportResult = reportAnalysis?.result
    ? enrichAIResult(reportAnalysis.result)
    : null;

  return (
    <>
      <div className="ai-entry-bar">
        <div>
          <strong className="ai-entry-title">{t("ai.panel_title")}</strong>
          <p>{statusLine}</p>
        </div>
        <div className="ai-entry-actions">
          {entry.mode === "idle" ? (
            <button
              type="button"
              className="primary"
              onClick={() => openSetup("start")}
            >
              {t("ai.btn_start")}
            </button>
          ) : null}
          {entry.mode === "running" ? (
            <button
              type="button"
              className="primary"
              onClick={() => openSetup("view", current?.id)}
            >
              {t("ai.btn_view_progress")}
            </button>
          ) : null}
          {entry.mode === "done" ? (
            <>
              <button
                type="button"
                className="primary"
                onClick={() => openReport(entry.latestDone)}
              >
                {t("ai.btn_view_report")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => openSetup("rerun")}
              >
                {t("ai.btn_rerun")}
              </button>
            </>
          ) : null}
          {entry.mode === "failed" ? (
            <>
              <button
                type="button"
                className="primary"
                onClick={() => openSetup("rerun")}
              >
                {t("ai.btn_rerun")}
              </button>
              {entry.latestDone ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => openReport(entry.latestDone)}
                >
                  {t("ai.btn_view_report")}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {setupOpen ? (
        <AIAnalysisDialog
          cid={cid}
          docs={docs}
          intent={intent}
          focusAnalysisId={focusAnalysisId}
          onClose={() => {
            setSetupOpen(false);
            void refresh();
          }}
          onViewReport={(analysis) => {
            openReport(analysis);
          }}
        />
      ) : null}
      <AIReportDialog
        open={Boolean(reportAnalysis && reportResult)}
        analysis={reportAnalysis}
        onClose={() => setReportAnalysis(null)}
        onCopy={() => void handleCopyExport(reportResult, "copy", t)}
        onExport={() => void handleCopyExport(reportResult, "export", t)}
      />
    </>
  );
}
