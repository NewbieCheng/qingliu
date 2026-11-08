import React, { useEffect, useState } from "react";
import { formatDateTime } from "@/shared/lib/format.js";
import { StatusBadge } from "@/shared/ui/Badge.jsx";
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

export function AIAnalysisPanel({ cid }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  async function start(task) {
    setBusy(true);
    setError("");
    try {
      await startAnalysis(cid, task);
      toast(
        task === "page_ocr"
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
      <div className="actions-row">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy ? "提交中…" : "生成 AI 辅助分析"}
        </button>
        <button
          className="ghost"
          disabled={busy}
          onClick={() => void start("page_ocr")}
          title="逐页渲染后由视觉模型转写，适合扫描件或图片型流水，页数较多时耗时更长"
        >
          文档视觉识别（OCR）
        </button>
        <button className="ghost" onClick={() => void load()}>
          刷新
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
          {latest.result?.income_structure?.length > 0 && (
            <div>
              <h3>收入结构</h3>
              <ul>
                {latest.result.income_structure.map((row, index) => (
                  <li key={index}>
                    {row.source} · {row.amount} <small>{row.evidence}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {latest.result?.anomalies?.length > 0 && (
            <div>
              <h3>异常点</h3>
              <ul>
                {latest.result.anomalies.map((row, index) => (
                  <li key={index}>
                    {row.item} <small>{row.evidence}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {latest.result?.questions?.length > 0 && (
            <div>
              <h3>建议核实</h3>
              <ul>
                {latest.result.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </div>
          )}
          {latest.result?.disclaimer && (
            <p className="muted">{latest.result.disclaimer}</p>
          )}
        </div>
      )}
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
