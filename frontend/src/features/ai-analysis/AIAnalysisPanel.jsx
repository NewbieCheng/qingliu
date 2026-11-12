import React, { useEffect, useState } from "react";
import { useI18n } from "@/shared/i18n/index.jsx";
import { formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { ModalActions } from "@/shared/ui/ModalActions.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { SegmentedControl } from "@/shared/ui/SegmentedControl.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { navigate } from "@/shared/router/index.js";
import { queryBalance } from "@/app/queries/index.js";
import { availablePoints } from "@/features/billing/index.js";
import { isInsufficientPointsError } from "@/shared/lib/billing.js";
import {
  applyAISuggest,
  applyAIWriteback,
  getAnalyses,
  startAnalysis,
} from "./api.js";
import {
  copyText,
  downloadText,
  enrichAIResult,
  formatAIExportText,
  formatAISummary,
  formatLocator,
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

const RESULT_PAGE_SIZE = 10;

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

function AIResultActions({ result, disabled }) {
  const { t } = useI18n();
  if (!result || disabled) return null;
  const text = formatAIExportText(result);
  if (!text) return null;
  return (
    <div className="ai-result-actions">
      <button
        type="button"
        className="ghost"
        onClick={() => void handleCopyExport(result, "copy", t)}
      >
        {t("common.copy")}
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => void handleCopyExport(result, "export", t)}
      >
        {t("common.export")}
      </button>
    </div>
  );
}

function AIResultDialog({ open, onClose, result }) {
  const { t } = useI18n();
  const tabs = [
    { key: "income_structure", label: t("ai.mode_analysis") },
    { key: "anomalies", label: t("case.review.title") },
    { key: "questions", label: t("ai.write_suggest") },
  ].filter((tab) => (result?.[tab.key] || []).length > 0);
  const [tab, setTab] = useState(tabs[0]?.key || "");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setTab(tabs[0]?.key || "");
    setPage(1);
  }, [open]);
  if (!open || !result || tabs.length === 0) return null;
  const activeTab = tabs.find((item) => item.key === tab) || tabs[0];
  const rows = result[activeTab.key] || [];
  const visible = rows.slice(
    (page - 1) * RESULT_PAGE_SIZE,
    page * RESULT_PAGE_SIZE,
  );
  return (
    <Modal title={t("ai.title")} onClose={onClose}>
      <div className="ai-result-actions ai-result-actions--top">
        <button
          type="button"
          className="ghost"
          onClick={() => void handleCopyExport(result, "copy", t)}
        >
          {t("common.copy")}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => void handleCopyExport(result, "export", t)}
        >
          {t("common.export")}
        </button>
      </div>
      <div className="modal-tabs" role="tablist" aria-label={t("ai.panel_title")}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.key === activeTab.key}
            className={item.key === activeTab.key ? "is-active" : ""}
            onClick={() => {
              setTab(item.key);
              setPage(1);
            }}
          >
            {item.label}（{result[item.key].length}）
          </button>
        ))}
      </div>
      <ul>
        {visible.map((row, index) => (
          <li key={index}>
            {typeof row === "string" ? (
              row
            ) : (
              <>
                {row.item || row.source || row.label || ""}
                {row.amount ? ` · ${row.amount}` : ""}
                {formatLocator(row) ? (
                  <small> {t("case.original.location")}: {formatLocator(row)}</small>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {rows.length > RESULT_PAGE_SIZE && (
        <Pagination
          page={page}
          onPrevious={() => setPage((value) => value - 1)}
          onNext={() => setPage((value) => value + 1)}
          canPrevious={page > 1}
          canNext={page * RESULT_PAGE_SIZE < rows.length}
          label={`${t("common.page", { page })} · ${rows.length}`}
        />
      )}
    </Modal>
  );
}

function AIAnalysisDialog({ cid, docs = [], onClose }) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultOpen, setResultOpen] = useState(false);
  const [mode, setMode] = useState("analysis");
  const [documentId, setDocumentId] = useState(docs[0]?.id || "");
  // 积分余额：AI 解析按用量扣积分，余额为 0 时先说清楚要充值，别让用户
  // 点了「开始分析」才吃一个 402。null = 还没读到（不阻塞按钮）。
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

  async function load() {
    try {
      const data = await getAnalyses(cid);
      setItems(data.items || []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    void load();
  }, [cid]);

  useEffect(() => {
    const latest = items[0];
    if (!latest || !isActiveStatus(latest.status)) {
      return undefined;
    }
    const timer = window.setInterval(load, 2500);
    return () => window.clearInterval(timer);
  }, [items[0]?.id, items[0]?.status, cid]);

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
      await load();
    } catch (requestError) {
      setError(requestError.message);
      // 402 = 积分不足：把余额归零并让「前往充值」条露出来，比只弹 toast 有用。
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
        n > 0
          ? t("ai.write_suggest")
          : t("ai.pick_doc"),
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

  const latest = items[0];
  const running = latest && isActiveStatus(latest.status);
  const percent = progressValue(latest);
  const displayResult = latest?.result ? enrichAIResult(latest.result) : null;
  const detailCount =
    (displayResult?.income_structure?.length || 0) +
    (displayResult?.anomalies?.length || 0) +
    (displayResult?.questions?.length || 0);
  const summaryText = displayResult
    ? formatAISummary(displayResult) || displayResult.summary || ""
    : "";
  const modeHint = t(AI_MODES.find((item) => item.value === mode)?.hintKey || AI_MODES[0].hintKey);
  const eta = t(ETA_HINT_KEY[mode] || ETA_HINT_KEY.analysis);

  return (
    <>
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
              <span>
                {t("ai.recharge_prompt_body")}
              </span>
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
                    {doc.meta?.pages ? ` · ${doc.meta.pages} pages` : ""}
                    {doc.meta?.rows ? ` · ${doc.meta.rows} rows` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {t("ai.need_upload")}
              </p>
            )}
            {selectedDoc ? (
              <p className="ai-mode-hint">
                {t("ai.mode_analysis_hint")}
              </p>
            ) : null}
          </label>
          <div>
            <SegmentedControl
              aria-label={t("ai.panel_title")}
              value={mode}
              onChange={setMode}
              options={AI_MODES.map((item) => ({ ...item, label: t(item.labelKey) }))}
            />
            <p className="ai-mode-hint">
              {modeHint} · {eta}
            </p>
          </div>
          <ModalActions>
            <button type="button" className="ghost" onClick={() => void load()}>
              {t("common.retry")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canStart || running}
              onClick={() => void start()}
            >
              {busy ? t("ai.status_queued") : t("ai.btn_start")}
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
                      {latest.stage === "running" ? t("ai.status_running") : t(STATUS_KEY[latest.status] || "ai.status_running")}
                      {" · "}
                      {eta}
                    </span>
                    <span>{percent}%</span>
                  </p>
                </>
              ) : null}
              <AIProcessLog process={displayResult?.process} />
              {summaryText ? (
                <p className="ai-summary" style={{ whiteSpace: "pre-wrap" }}>
                  {summaryText}
                  {running && displayResult?.partial ? "…" : ""}
                </p>
              ) : latest.status === "done" ? (
                <p className="muted">{t("ai.status_done")}</p>
              ) : running ? (
                <p className="muted">{t("ai.status_running")}</p>
              ) : null}
              <AIResultActions result={displayResult} />
              {latest.status === "done" ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void writeSuggest()}
                >
                  Write suggestions to review
                </button>
              ) : null}
              {latest.status === "done" && displayResult?.text ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => void writeOCRRows()}
                >
                  {t("ai.write_suggest")}
                </button>
              ) : null}
              {detailCount > 0 ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setResultOpen(true)}
                >
                  {t("ai.title")} ({detailCount}) →
                </button>
              ) : null}
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
      <AIResultDialog
        open={resultOpen && detailCount > 0}
        onClose={() => setResultOpen(false)}
        result={displayResult}
      />
    </>
  );
}

/** 报告页入口：右侧入口按钮 + 弹窗，不再常驻侧栏。 */
export function AIAnalysisPanel({ cid, docs = [] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState(null);

  async function refresh() {
    try {
      const data = await getAnalyses(cid);
      setLatest(data.items?.[0] || null);
    } catch {
      setLatest(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    getAnalyses(cid)
      .then((data) => {
        if (!cancelled) setLatest(data.items?.[0] || null);
      })
      .catch(() => {
        if (!cancelled) setLatest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cid, open]);

  // 入口卡与弹窗、任务坞共用同一进度真相：进行中持续轮询 analyses。
  useEffect(() => {
    if (open) return undefined;
    if (!latest || !isActiveStatus(latest.status)) return undefined;
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [cid, open, latest?.id, latest?.status]);

  const running = latest && isActiveStatus(latest.status);
  const failed = latest?.status === "failed";
  const percent = progressValue(latest);
  const eta = t(ETA_HINT_KEY.analysis);

  let statusLine = t("ai.panel_title");
  if (running) {
    statusLine = `${t("ai.status_running")} (${t(STATUS_KEY[latest.status] || "ai.status_running")} ${percent}% · ${eta})`;
  } else if (failed) {
    statusLine = `${t("ai.status_failed")}${latest.error ? `: ${latest.error}` : ""}`;
  }

  return (
    <>
      <div className="ai-entry-bar">
        <div>
          <strong className="ai-entry-title">{t("ai.panel_title")}</strong>
          <p>{statusLine}</p>
        </div>
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          {running ? t("ai.status_running") : failed ? t("ai.status_failed") : t("ai.btn_start")}
        </button>
      </div>
      {open ? (
        <AIAnalysisDialog
          cid={cid}
          docs={docs}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
