import React, { useEffect, useState } from "react";
import { formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
import { Modal } from "@/shared/ui/Modal.jsx";
import { Pagination } from "@/shared/ui/Pagination.jsx";
import { SectionTitle } from "@/shared/ui/PageHeader.jsx";
import { toast } from "@/shared/ui/toast-api.js";
import { getAnalyses, startAnalysis } from "./api.js";

const STATUS = {
  uploading: "正在上传",
  queued: "排队中",
  running: "分析中",
  done: "已完成",
  failed: "失败",
};

const RESULT_PAGE_SIZE = 10;

// AI 完整结果弹窗：tabs（收入结构 / 异常点 / 建议核实）+ 超 10 条分页。
// 行内只留状态 + 摘要 + 入口，长列表不再把页面撑开。
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
  const visible = rows.slice((page - 1) * RESULT_PAGE_SIZE, page * RESULT_PAGE_SIZE);
  return (
    <Modal title="AI 分析完整结果" onClose={onClose}>
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

const AI_MODES = [
  {
    value: "analysis",
    label: "智能解析",
    hint: "直接读版式，快，适合原生 PDF / 表格清晰的流水",
  },
  {
    value: "page_ocr",
    label: "文档 OCR 转写",
    hint: "逐页渲染后视觉转写，适合扫描件或图片型流水页多时较慢",
  },
];

export function AIAnalysisPanel({ cid }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultOpen, setResultOpen] = useState(false);
  const [mode, setMode] = useState("analysis");

  async function load() {
    try {
      const data = await getAnalyses(cid);
      setItems(data.items || []);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    void load();
  }, [cid]);

  useEffect(() => {
    const latest = items[0];
    if (!latest || !["uploading", "queued", "running"].includes(latest.status)) {
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
          ? "已提交文档视觉识别，将逐页转写；进度在下方显示。"
          : "已提交，AI 正在阅读原件；完成后会显示在这里。",
        "info",
      );
      await load();
    } catch (requestError) {
      setError(requestError.message);
      toast(requestError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const latest = items[0];
  const detailCount =
    (latest?.result?.income_structure?.length || 0) +
    (latest?.result?.anomalies?.length || 0) +
    (latest?.result?.questions?.length || 0);

  return (
    <section className="card ai-panel">
      <SectionTitle
        title="AI 辅助分析"
        description="基于原件文字与页面视觉生成摘要、异常点和需核实问题；不替代规则结论，不自动签发报告。"
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div
        className="ai-mode"
        role="radiogroup"
        aria-label="AI 分析方式"
      >
        {AI_MODES.map((item) => (
          <label
            key={item.value}
            className={mode === item.value ? "is-active" : ""}
          >
            <input
              type="radio"
              name={`ai-mode-${cid}`}
              value={item.value}
              checked={mode === item.value}
              onChange={() => setMode(item.value)}
            />
            <span>
              {item.label}
              <small>{item.hint}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="actions-end">
        <button className="ghost" onClick={() => void load()}>
          刷新
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy ? "提交中…" : "开始分析"}
        </button>
      </div>
      {latest && (
        <div className="ai-result">
          <p className="muted">
            状态：
            <StatusBadge tone={latest.status === "done" ? "default" : "amber"}>
              {STATUS[latest.status] || latest.status}
            </StatusBadge>
            {latest.error ? ` · ${latest.error}` : ""}
          </p>
          {["uploading", "queued", "running"].includes(latest.status) && (
            <>
              <div
                className="task-progress"
                role="progressbar"
                aria-valuenow={Number(latest.progress) || 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="AI 分析进度"
              >
                <div
                  className="task-progress-bar"
                  style={{ width: `${Math.max(0, Math.min(100, Number(latest.progress) || 0))}%` }}
                />
              </div>
              <p className="task-meta">
                <span>{latest.stage === "running" ? "逐页识别中" : "分析中"}</span>
                <span>{Number(latest.progress) || 0}%</span>
              </p>
            </>
          )}
          {latest.result?.summary && (
            <p className="ai-summary">{latest.result.summary}</p>
          )}
          {detailCount > 0 && (
            <button
              type="button"
              className="ghost"
              onClick={() => setResultOpen(true)}
            >
              查看完整结果（{detailCount} 项）→
            </button>
          )}
          {latest.result?.disclaimer && (
            <p className="muted">{latest.result.disclaimer}</p>
          )}
        </div>
      )}
      <AIResultDialog
        open={resultOpen && detailCount > 0}
        onClose={() => setResultOpen(false)}
        result={latest?.result}
      />
      {items.length > 1 && (
        <details>
          <summary>历史分析（{items.length}）</summary>
          <ul>
            {items.slice(1).map((item) => (
              <li key={item.id}>
                {formatDateTime(item.created)} · {STATUS[item.status] || item.status}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
