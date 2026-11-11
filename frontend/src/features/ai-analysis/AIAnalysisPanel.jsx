import React, { useEffect, useState } from "react";
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

const STATUS = {
  uploading: "正在上传",
  queued: "Queued",
  running: "Analyzing",
  done: "Done",
  failed: "Failed",
};

const ETA_HINT = {
  analysis: "Usually 1–3 minutes",
  page_ocr: "预计约 3–8 分钟",
};

const RESULT_PAGE_SIZE = 10;

const AI_MODES = [
  {
    value: "analysis",
    label: "Smart analysis",
    hint: "Reads layout directly; fast for native PDF / clear table statements",
  },
  {
    value: "page_ocr",
    label: "文档 OCR 转写",
    hint: "Page render + vision OCR; good for scans/images; slower with many pages",
  },
];

function isActiveStatus(status) {
  return ["uploading", "queued", "running"].includes(status);
}

function progressValue(item) {
  return Math.max(0, Math.min(100, Number(item?.progress) || 0));
}

async function handleCopyExport(result, action) {
  try {
    const text = formatAIExportText(result);
    if (action === "copy") {
      await copyText(text);
      toast("已复制分析结果", "success");
      return;
    }
    downloadText(`ai-analysis-${Date.now()}.txt`, text);
    toast("已导出分析结果", "success");
  } catch (requestError) {
    toast(requestError.message || "Failed", "error");
  }
}

function AIProcessLog({ process }) {
  if (!process?.length) return null;
  const visible = process.slice(-12);
  return (
    <div className="ai-process" aria-live="polite">
      <h3>思考过程</h3>
      <ol>
        {visible.map((line, index) => (
          <li key={`${index}-${line.slice(0, 24)}`}>{line}</li>
        ))}
      </ol>
      {process.length > visible.length ? (
        <p className="muted">仅显示最近 {visible.length} 条</p>
      ) : null}
    </div>
  );
}

function AIResultActions({ result, disabled }) {
  if (!result || disabled) return null;
  const text = formatAIExportText(result);
  if (!text) return null;
  return (
    <div className="ai-result-actions">
      <button
        type="button"
        className="ghost"
        onClick={() => void handleCopyExport(result, "copy")}
      >
        Copy
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => void handleCopyExport(result, "export")}
      >
        Export
      </button>
    </div>
  );
}

function AIResultDialog({ open, onClose, result }) {
  const tabs = [
    { key: "income_structure", label: "Income mix" },
    { key: "anomalies", label: "异常点" },
    { key: "questions", label: "Suggested review" },
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
    <Modal title="AI 分析完整结果" onClose={onClose}>
      <div className="ai-result-actions ai-result-actions--top">
        <button
          type="button"
          className="ghost"
          onClick={() => void handleCopyExport(result, "copy")}
        >
          复制全部
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => void handleCopyExport(result, "export")}
        >
          导出全部
        </button>
      </div>
      <div className="modal-tabs" role="tablist" aria-label="分析结果分类">
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
                  <small> 定位：{formatLocator(row)}</small>
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
          label={`第 ${page} 页 / 共 ${rows.length} 条`}
        />
      )}
    </Modal>
  );
}

function AIAnalysisDialog({ cid, docs = [], onClose }) {
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
      const message = docs.length
        ? "Select a document to analyze"
        : "Upload documents before starting analysis";
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
        mode === "page_ocr"
          ? `已提交文档视觉识别；${ETA_HINT.page_ocr}，进度与思考过程会在下方陆续出现。`
          : `已提交，AI 正在阅读原件；${ETA_HINT.analysis}，过程会在下方陆续出现。`,
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
          ? `已写入 ${n} 笔核对预勾；请到「逐笔核对」查看并采纳`
          : "No entries with transaction anchors; could not write pre-checks",
        n > 0 ? "success" : "info",
      );
    } catch (requestError) {
      toast(requestError.message || "写入预勾失败", "error");
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
          ? `已写回 ${n} 笔交易，请到「逐笔核对」查看`
          : "没有可写回的交易行",
        n > 0 ? "success" : "info",
      );
    } catch (requestError) {
      toast(requestError.message || "写回核对失败", "error");
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
  const modeHint =
    AI_MODES.find((item) => item.value === mode)?.hint || AI_MODES[0].hint;
  const eta = ETA_HINT[mode] || ETA_HINT.analysis;

  return (
    <>
      <Modal title="AI analysis" onClose={onClose} className="modal--sm">
        <div className="ai-dialog-body">
          <p className="muted" style={{ margin: 0 }}>
            基于原件文字与页面视觉生成摘要、异常点和需核实问题；不替代规则结论，不自动签发报告。
          </p>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {needRecharge ? (
            <div className="billing-notice" role="status">
              <span>
                当前积分 {Number(points).toLocaleString("zh-CN")}
                ，AI 解析与文档解析按用量扣积分，充值后即可提交。
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  onClose();
                  navigate("/recharge");
                }}
              >
                前往充值
              </button>
            </div>
          ) : null}
          <label className="field">
            <span>分析文档（必选）</span>
            {docs.length ? (
              <select
                value={documentId}
                onChange={(event) => setDocumentId(event.target.value)}
                disabled={busy || running}
                aria-label="选择要分析的文档"
              >
                {docs.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name}
                    {doc.meta?.pages ? ` · ${doc.meta.pages} 页` : ""}
                    {doc.meta?.rows ? ` · ${doc.meta.rows} 笔` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                还没有可分析的资料，请先在上传步骤提交原件。
              </p>
            )}
            {selectedDoc ? (
              <p className="ai-mode-hint">
                将阅读「{selectedDoc.name}」；定位说明会出现在异常点与建议核实条目中。
              </p>
            ) : null}
          </label>
          <div>
            <SegmentedControl
              aria-label="AI 分析方式"
              value={mode}
              onChange={setMode}
              options={AI_MODES}
            />
            <p className="ai-mode-hint">
              {modeHint} · {eta}
            </p>
          </div>
          <ModalActions>
            <button type="button" className="ghost" onClick={() => void load()}>
              Refresh
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canStart || running}
              onClick={() => void start()}
            >
              {busy ? "提交中…" : "Start analysis"}
            </button>
          </ModalActions>
          {latest ? (
            <div className="ai-result">
              <p className="muted">
                状态：
                <StatusBadge
                  tone={
                    latest.status === "done"
                      ? "default"
                      : latest.status === "failed"
                        ? "amber"
                        : "amber"
                  }
                >
                  {STATUS[latest.status] || latest.status}
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
                    aria-label="AI 分析进度"
                  >
                    <div
                      className="task-progress-bar"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="task-meta">
                    <span>
                      {latest.stage === "running" ? "Analyzing" : STATUS[latest.status] || "Analyzing"}
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
                <p className="muted">分析已完成，但没有可展示的中文摘要。</p>
              ) : running ? (
                <p className="muted">正在整理片段，稍后会陆续出现摘要与思考过程。</p>
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
                  写回核对交易
                </button>
              ) : null}
              {detailCount > 0 ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setResultOpen(true)}
                >
                  查看完整结果（{detailCount} 项）→
                </button>
              ) : null}
              {displayResult?.disclaimer ? (
                <p className="muted">{displayResult.disclaimer}</p>
              ) : null}
            </div>
          ) : null}
          {items.length > 1 ? (
            <FoldPanel title={`历史分析（${items.length}）`}>
              <ul>
                {items.slice(1).map((item) => (
                  <li key={item.id}>
                    {formatDateTime(item.created)} ·{" "}
                    {STATUS[item.status] || item.status}
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
  const eta = ETA_HINT.analysis;

  let statusLine =
    "Summaries and anomalies from originals; does not replace rule conclusions or auto-issue.";
  if (running) {
    statusLine = `分析进行中（${STATUS[latest.status] || latest.status} ${percent}% · ${eta}）`;
  } else if (failed) {
    statusLine = `上次分析失败${latest.error ? `：${latest.error}` : ""}`;
  }

  return (
    <>
      <div className="ai-entry-bar">
        <div>
          <strong className="ai-entry-title">AI analysis</strong>
          <p>{statusLine}</p>
        </div>
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          {running ? "查看进度" : failed ? "查看并重试" : "Start analysis"}
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
