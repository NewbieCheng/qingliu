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
import { getAnalyses, startAnalysis } from "./api.js";
import {
  copyText,
  downloadText,
  enrichAIResult,
  formatAIExportText,
  formatAISummary,
} from "./format-result.js";

const STATUS = {
  uploading: "正在上传",
  queued: "排队中",
  running: "分析中",
  done: "已完成",
  failed: "失败",
};

const ETA_HINT = {
  analysis: "预计约 1–3 分钟",
  page_ocr: "预计约 3–8 分钟",
};

const RESULT_PAGE_SIZE = 10;

const AI_MODES = [
  {
    value: "analysis",
    label: "智能解析",
    hint: "直接读版式，快，适合原生 PDF / 表格清晰的流水",
  },
  {
    value: "page_ocr",
    label: "文档 OCR 转写",
    hint: "逐页渲染后视觉转写，适合扫描件或图片型流水；页多时较慢",
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
    toast(requestError.message || "操作失败", "error");
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
        复制
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => void handleCopyExport(result, "export")}
      >
        导出
      </button>
    </div>
  );
}

function AIResultDialog({ open, onClose, result }) {
  const tabs = [
    { key: "income_structure", label: "收入结构" },
    { key: "anomalies", label: "异常点" },
    { key: "questions", label: "建议核实" },
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
                {row.item || row.source || ""}
                {row.amount ? ` · ${row.amount}` : ""}
                {row.evidence && <small> {row.evidence}</small>}
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

function AIAnalysisDialog({ cid, onClose }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultOpen, setResultOpen] = useState(false);
  const [mode, setMode] = useState("analysis");
  // 积分余额：AI 解析按用量扣积分，余额为 0 时先说清楚要充值，别让用户
  // 点了「开始分析」才吃一个 402。null = 还没读到（不阻塞按钮）。
  const [points, setPoints] = useState(null);

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
    setBusy(true);
    setError("");
    try {
      await startAnalysis(cid, mode === "page_ocr" ? mode : undefined);
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
      <Modal title="AI 辅助分析" onClose={onClose} className="modal--sm">
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
              刷新
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void start()}
            >
              {busy ? "提交中…" : "开始分析"}
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
                      {latest.stage === "running" ? "分析中" : STATUS[latest.status] || "分析中"}
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
export function AIAnalysisPanel({ cid }) {
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
    "基于原件生成摘要与异常点，不替代规则结论、不自动签发。";
  if (running) {
    statusLine = `分析进行中（${STATUS[latest.status] || latest.status} ${percent}% · ${eta}）`;
  } else if (failed) {
    statusLine = `上次分析失败${latest.error ? `：${latest.error}` : ""}`;
  }

  return (
    <>
      <div className="ai-entry-bar">
        <div>
          <strong className="ai-entry-title">AI 辅助分析</strong>
          <p>{statusLine}</p>
        </div>
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          {running ? "查看进度" : failed ? "查看并重试" : "开始分析"}
        </button>
      </div>
      {open ? (
        <AIAnalysisDialog cid={cid} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
