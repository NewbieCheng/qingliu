import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { RefreshIcon, SparkIcon, FileTextIcon, WalletIcon } from "@/shared/ui/icons.jsx";
import { formatDateTime } from "@/shared/lib/format.js";
import { SOURCES } from "@/shared/lib/constants.js";
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
  startPersonMerge,
} from "./api.js";
import {
  isActiveStatus,
  latestAnalysisByDoc,
  matrixStats,
  mergeCandidates,
  recentPersonMerges,
} from "./doc-matrix.js";
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

function progressValue(item) {
  return Math.max(0, Math.min(100, Number(item?.progress) || 0));
}

function docMeta(doc) {
  return doc?.meta && typeof doc.meta === "object" ? doc.meta : {};
}

function sourceLabel(doc, t) {
  const source = docMeta(doc).source;
  return t(SOURCES[source] || "source.other");
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

function DocStatusBadge({ item, t }) {
  if (!item) {
    return <StatusBadge tone="default">{t("ai.status_idle")}</StatusBadge>;
  }
  const tone =
    item.status === "done"
      ? "default"
      : item.status === "failed"
        ? "amber"
        : "amber";
  return (
    <StatusBadge tone={tone}>
      {t(STATUS_KEY[item.status] || "ai.status_failed")}
      {isActiveStatus(item.status) ? ` ${progressValue(item)}%` : ""}
    </StatusBadge>
  );
}

function AIAnalysisDialog({
  cid,
  docs = [],
  onClose,
  intent = "start",
  focusAnalysisId = "",
  initialSelected = [],
  onViewReport,
  onCaseRefresh,
}) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("analysis");
  const [selected, setSelected] = useState(() => new Set(initialSelected.map(String)));
  const [points, setPoints] = useState(null);

  useEffect(() => {
    const allowed = new Set(docs.map((doc) => String(doc.id)));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      if (!next.size && docs[0]?.id) next.add(String(docs[0].id));
      return next;
    });
  }, [docs]);

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

  const byDoc = useMemo(() => latestAnalysisByDoc(items), [items]);
  const activeCount = items.filter((item) => isActiveStatus(item.status)).length;
  const running = activeCount > 0;

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      void load({ force: true });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [running, activeCount, cid]);

  function toggleDoc(id) {
    const key = String(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === docs.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(docs.map((doc) => String(doc.id))));
  }

  async function start() {
    const documentIds = [...selected];
    if (!documentIds.length) {
      const message = docs.length ? t("ai.pick_doc") : t("ai.need_upload");
      setError(message);
      toast(message, "error");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await startAnalysis(cid, {
        documentIds,
        task: mode === "page_ocr" ? mode : undefined,
      });
      toast(
        documentIds.length > 1
          ? t("ai.start_batch", { n: documentIds.length })
          : mode === "page_ocr"
            ? t("ai.start_ocr")
            : t("ai.start_analysis"),
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

  const focusItem =
    (focusAnalysisId &&
      items.find((item) => String(item.id) === String(focusAnalysisId))) ||
    items.find((item) => item.status === "done") ||
    items[0];
  const displayResult = focusItem?.result ? enrichAIResult(focusItem.result) : null;
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
  const canStart = selected.size > 0 && !busy && !needRecharge;
  const percent = progressValue(focusItem);

  async function writeSuggest() {
    if (!focusItem?.id || focusItem.status !== "done") return;
    setBusy(true);
    try {
      const data = await applyAISuggest(cid, focusItem.id);
      const n = Number(data?.applied) || 0;
      toast(
        n > 0 ? t("ai.write_suggest") : t("ai.pick_doc"),
        n > 0 ? "success" : "info",
      );
      if (n > 0) onCaseRefresh?.();
    } catch (requestError) {
      toast(requestError.message || t("ai.write_suggest"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function writeOCRRows() {
    if (!focusItem?.id || focusItem.status !== "done") return;
    setBusy(true);
    try {
      const data = await applyAIWriteback(cid, focusItem.id);
      const n = Number(data?.rows) || 0;
      toast(
        n > 0
          ? t("case.review.adopt_ai_suggestions", { count: n })
          : t("ai.pick_doc"),
        n > 0 ? "success" : "info",
      );
      if (n > 0) onCaseRefresh?.();
    } catch (requestError) {
      toast(requestError.message || t("case.review.title"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("ai.title")} onClose={onClose} className="modal--sm">
      <div className="ai-dialog-body">
        <p className="muted" style={{ margin: 0 }}>
          {t("ai.batch_hint")}
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
              className="btn-outline"
              onClick={() => {
                onClose();
                navigate("/recharge");
              }}
            >
              <WalletIcon size={14} />{t("ai.go_recharge")}
            </button>
          </div>
        ) : null}
        <div className="ai-doc-picker">
          <div className="ai-doc-picker-head">
            <span>{t("ai.pick_docs")}</span>
            {docs.length ? (
              <button type="button" className="btn-chip" onClick={toggleAll} disabled={busy}>
                {selected.size === docs.length
                  ? t("ai.unselect_all")
                  : t("ai.select_all")}
              </button>
            ) : null}
          </div>
          {docs.length ? (
            <ul className="ai-doc-check-list">
              {docs.map((doc) => {
                const id = String(doc.id);
                const item = byDoc.get(id);
                const meta = docMeta(doc);
                return (
                  <li key={id}>
                    <label className="ai-doc-check">
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        disabled={busy}
                        onChange={() => toggleDoc(id)}
                      />
                      <span className="ai-doc-check-main">
                        <strong>{doc.name}</strong>
                        <span className="muted">
                          {sourceLabel(doc, t)}
                          {meta.pages
                            ? ` · ${t("ai.doc_pages", { n: meta.pages })}`
                            : ""}
                          {meta.rows
                            ? ` · ${t("ai.doc_rows", { n: meta.rows })}`
                            : ""}
                        </span>
                      </span>
                      <DocStatusBadge item={item} t={t} />
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {t("ai.need_upload")}
            </p>
          )}
        </div>
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
            className="btn-outline"
            onClick={() => void load({ force: true })}
          >
            <RefreshIcon size={14} />{t("topbar.refresh")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canStart}
            onClick={() => void start()}
          >
            {busy
              ? t("ai.status_queued")
              : selected.size > 1
                ? t("ai.btn_start_n", { n: selected.size })
                : intent === "rerun"
                  ? t("ai.btn_rerun")
                  : t("ai.btn_start")}
          </button>
        </ModalActions>
        {focusItem ? (
          <div className="ai-result">
            <p className="muted">
              {t("ai.title")}:
              <StatusBadge
                tone={
                  focusItem.status === "done"
                    ? "default"
                    : focusItem.status === "failed"
                      ? "amber"
                      : "amber"
                }
              >
                {t(STATUS_KEY[focusItem.status] || "ai.status_failed")}
              </StatusBadge>
              {focusItem.error ? ` · ${focusItem.error}` : ""}
              {activeCount > 1
                ? ` · ${t("ai.queue_active", { n: activeCount })}`
                : ""}
            </p>
            {isActiveStatus(focusItem.status) ? (
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
                    {focusItem.stage === "running"
                      ? t("ai.status_running")
                      : t(STATUS_KEY[focusItem.status] || "ai.status_running")}
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
                trailing={
                  isActiveStatus(focusItem.status) && displayResult?.partial
                    ? "…"
                    : ""
                }
              />
            ) : focusItem.status === "done" ? (
              <p className="muted">{t("ai.status_done")}</p>
            ) : isActiveStatus(focusItem.status) ? (
              <p className="muted">{t("ai.status_running")}</p>
            ) : null}
            <div className="ai-result-actions ai-result-actions--stack">
              <AIResultActions result={displayResult} />
              {focusItem.status === "done" &&
              displayResult?.kind !== "person_merge" ? (
                <button
                  type="button"
                  className="btn-chip"
                  disabled={busy}
                  onClick={() => void writeSuggest()}
                >
                  {t("ai.write_suggest")}
                </button>
              ) : null}
              {focusItem.status === "done" && displayResult?.text ? (
                <button
                  type="button"
                  className="btn-chip"
                  disabled={busy}
                  onClick={() => void writeOCRRows()}
                >
                  {t("ai.write_ocr")}
                </button>
              ) : null}
              {detailCount > 0 || (focusItem.status === "done" && summaryText) ? (
                <button
                  type="button"
                  className="btn-chip is-ok"
                  onClick={() => onViewReport?.(focusItem)}
                >
                  {detailCount > 0
                    ? t("ai.view_details", { n: detailCount })
                    : t("ai.btn_view_report")}
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
              {items.slice(0, 12).map((item) => (
                <li key={item.id}>
                  {formatDateTime(item.created)} ·{" "}
                  {t(STATUS_KEY[item.status] || "ai.status_failed")}
                  {item.result?.kind === "person_merge"
                    ? ` · ${t("ai.merge_label")}`
                    : ""}
                </li>
              ))}
            </ul>
          </FoldPanel>
        ) : null}
      </div>
    </Modal>
  );
}

/** 核对页入口：panel=整块矩阵；toolbar=表头按钮弹出矩阵；写回后刷新底稿。 */
export function AIAnalysisPanel({
  cid,
  docs = [],
  onCaseRefresh,
  variant = "panel",
}) {
  const { t } = useI18n();
  const [setupOpen, setSetupOpen] = useState(false);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [intent, setIntent] = useState("start");
  const [focusAnalysisId, setFocusAnalysisId] = useState("");
  const [initialSelected, setInitialSelected] = useState([]);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [reportAnalysis, setReportAnalysis] = useState(null);
  const matrixGuardUntil = useRef(0);
  const isToolbar = variant === "toolbar";

  function openMatrixSheet() {
    // summary 内点击会穿透到刚挂上的 overlay；短暂忽略关闭。
    matrixGuardUntil.current = Date.now() + 400;
    setMatrixOpen(true);
  }

  function closeMatrixSheet() {
    if (Date.now() < matrixGuardUntil.current) return;
    setMatrixOpen(false);
    void refresh();
  }

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

  useEffect(() => {
    const allowed = new Set(docs.map((doc) => String(doc.id)));
    setSelected((prev) => new Set([...prev].filter((id) => allowed.has(id))));
  }, [docs]);

  const byDoc = useMemo(() => latestAnalysisByDoc(items), [items]);
  const stats = useMemo(() => matrixStats(docs, byDoc), [docs, byDoc]);
  const candidates = useMemo(() => mergeCandidates(items), [items]);
  const merges = useMemo(() => recentPersonMerges(items), [items]);
  const running = stats.active > 0;

  useEffect(() => {
    if (!running) return undefined;
    // 表头徽章也要跟进度；弹层打开时略勤一点。
    const ms = setupOpen || matrixOpen ? 2500 : 5000;
    const timer = window.setInterval(() => {
      void refresh({ force: true });
    }, ms);
    return () => window.clearInterval(timer);
  }, [cid, setupOpen, matrixOpen, running, stats.active]);

  let statusLine = t("ai.entry_idle");
  if (docs.length) {
    statusLine = t("ai.entry_matrix", {
      done: stats.done,
      total: stats.total,
      active: stats.active,
    });
    if (stats.active > 0) {
      statusLine += ` · ${t("ai.queue_active", { n: stats.active })}`;
    } else if (stats.failed > 0) {
      statusLine += ` · ${t("ai.entry_failed_n", { n: stats.failed })}`;
    }
  }

  function openSetup(nextIntent, analysisId = "", docIds = []) {
    setIntent(nextIntent);
    setFocusAnalysisId(analysisId || "");
    setInitialSelected(docIds);
    setSetupOpen(true);
  }

  function openReport(analysis) {
    if (!analysis?.result) {
      openSetup("view", analysis?.id);
      return;
    }
    setReportAnalysis(analysis);
  }

  function toggleDoc(id) {
    const key = String(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === docs.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(docs.map((doc) => String(doc.id))));
  }

  async function batchStart(docIds) {
    const ids = docIds?.length ? docIds : [...selected];
    if (!ids.length) {
      toast(t("ai.pick_doc"), "error");
      return;
    }
    setBusy(true);
    try {
      await startAnalysis(cid, { documentIds: ids });
      toast(
        ids.length > 1
          ? t("ai.start_batch", { n: ids.length })
          : t("ai.start_analysis"),
        "info",
      );
      invalidateAnalyses(cid);
      await refresh({ force: true });
      setSelected(new Set());
    } catch (requestError) {
      toast(requestError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function runMerge() {
    if (candidates.length < 2) {
      toast(t("ai.merge_need_two"), "error");
      return;
    }
    setBusy(true);
    try {
      await startPersonMerge(
        cid,
        candidates.map((item) => item.id),
      );
      toast(t("ai.merge_started"), "info");
      invalidateAnalyses(cid);
      await refresh({ force: true });
    } catch (requestError) {
      toast(requestError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const reportResult = reportAnalysis?.result
    ? enrichAIResult(reportAnalysis.result)
    : null;

  const matrixBody = (
    <div className="ai-entry-matrix">
      <div className="ai-entry-bar">
        <div>
          {!isToolbar ? (
            <strong className="ai-entry-title">{t("ai.panel_title")}</strong>
          ) : null}
          <p>{statusLine}</p>
        </div>
        <div className="ai-entry-actions">
          {docs.length ? (
            <button
              type="button"
              className="btn-chip"
              onClick={toggleAll}
              disabled={busy}
            >
              {selected.size === docs.length
                ? t("ai.unselect_all")
                : t("ai.select_all")}
            </button>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={busy || !docs.length}
            onClick={() => {
              if (selected.size) {
                void batchStart([...selected]);
                return;
              }
              openSetup("start");
            }}
          >
            {selected.size > 1
              ? t("ai.btn_start_n", { n: selected.size })
              : selected.size === 1
                ? t("ai.btn_start")
                : t("ai.btn_open_picker")}
          </button>
          {running ? (
            <button
              type="button"
              className="btn-outline"
              onClick={() => openSetup("view")}
            >
              {t("ai.btn_view_progress")}
            </button>
          ) : null}
        </div>
      </div>

      {docs.length ? (
        <ul className="ai-doc-matrix">
          {docs.map((doc) => {
            const id = String(doc.id);
            const item = byDoc.get(id);
            const meta = docMeta(doc);
            return (
              <li key={id} className="ai-doc-matrix-row">
                <label className="ai-doc-check">
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    disabled={busy}
                    onChange={() => toggleDoc(id)}
                  />
                  <span className="ai-doc-check-main">
                    <strong>{doc.name}</strong>
                    <span className="muted">
                      {sourceLabel(doc, t)}
                      {meta.pages
                        ? ` · ${t("ai.doc_pages", { n: meta.pages })}`
                        : ""}
                      {meta.rows
                        ? ` · ${t("ai.doc_rows", { n: meta.rows })}`
                        : ""}
                    </span>
                  </span>
                </label>
                <div className="ai-doc-matrix-meta">
                  <DocStatusBadge item={item} t={t} />
                  {item?.status === "done" ? (
                    <button
                      type="button"
                      className="btn-chip"
                      onClick={() => openReport(item)}
                    >
                      <FileTextIcon size={14} />
                      {t("ai.btn_view_report")}
                    </button>
                  ) : null}
                  {item?.status === "failed" || !item ? (
                    <button
                      type="button"
                      className="btn-chip"
                      disabled={busy}
                      onClick={() => void batchStart([id])}
                    >
                      <SparkIcon size={14} />
                      {item?.status === "failed"
                        ? t("ai.btn_rerun")
                        : t("ai.btn_start")}
                    </button>
                  ) : null}
                  {item?.status === "done" ? (
                    <button
                      type="button"
                      className="btn-chip"
                      disabled={busy}
                      onClick={() => openSetup("rerun", item.id, [id])}
                    >
                      <SparkIcon size={14} />
                      {t("ai.btn_rerun")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted ai-entry-empty">{t("ai.need_upload")}</p>
      )}

      <div className="ai-merge-bar">
        <div>
          <strong>{t("ai.merge_title")}</strong>
          <p className="muted">
            {candidates.length >= 2
              ? t("ai.merge_ready", { n: candidates.length })
              : t("ai.merge_hint")}
          </p>
        </div>
        <button
          type="button"
          className="btn-outline"
          disabled={busy || candidates.length < 2}
          onClick={() => void runMerge()}
        >
          {t("ai.btn_merge")}
        </button>
      </div>

      {merges.length ? (
        <FoldPanel title={t("ai.merge_history", { n: merges.length })}>
          <ul className="ai-merge-history">
            {merges.map((item) => (
              <li key={item.id}>
                <span>
                  {formatDateTime(item.completed || item.created)} ·{" "}
                  {t(STATUS_KEY[item.status] || "ai.status_failed")}
                </span>
                {item.status === "done" ? (
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => openReport(item)}
                  >
                    {t("ai.btn_view_report")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </FoldPanel>
      ) : null}
    </div>
  );

  const allDone = docs.length > 0 && stats.done >= stats.total && !running;
  const toolbarBadge = docs.length
    ? running
      ? String(stats.active)
      : t("ai.toolbar_progress", { done: stats.done, total: stats.total })
    : null;
  const cornerTone = running ? "is-live" : allDone ? "is-done" : stats.failed > 0 ? "is-warn" : "";

  return (
    <>
      {isToolbar ? (
        <button
          type="button"
          className={`ai-toolbar-trigger${running ? " is-active" : ""}${
            matrixOpen ? " is-open" : ""
          }${allDone ? " is-complete" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={matrixOpen}
          aria-label={`${t("ai.panel_title")} · ${statusLine}`}
          title={statusLine}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            window.setTimeout(openMatrixSheet, 0);
          }}
        >
          <span className="ai-toolbar-trigger-main">
            <SparkIcon size={13} />
            <span className="ai-toolbar-trigger-label">{t("ai.toolbar_label")}</span>
          </span>
          {toolbarBadge ? (
            <span className={`ai-toolbar-corner ${cornerTone}`.trim()} aria-hidden="true">
              {toolbarBadge}
            </span>
          ) : null}
        </button>
      ) : (
        matrixBody
      )}

      {isToolbar && matrixOpen ? (
        <Modal
          title={t("ai.panel_title")}
          className="modal--md ai-matrix-sheet"
          onClose={closeMatrixSheet}
        >
          {matrixBody}
        </Modal>
      ) : null}

      {setupOpen ? (
        <AIAnalysisDialog
          cid={cid}
          docs={docs}
          intent={intent}
          focusAnalysisId={focusAnalysisId}
          initialSelected={initialSelected}
          onCaseRefresh={onCaseRefresh}
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
