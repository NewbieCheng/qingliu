import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { JOB_STATUS } from "@/shared/lib/constants.js";
import { Form } from "@/shared/ui/Form.jsx";
import { StatusBadge } from "@/shared/ui/Badge.jsx";

const KIND_LABEL = {
  upload: "资料识别",
  report: "报告生成",
  ai_analysis: "AI 辅助分析",
};

const STAGE_LABEL = {
  queued: "排队中",
  starting: "准备处理",
  parsing: "逐页识别",
  rendering: "生成文件",
  uploading: "上传原件",
  creating: "创建任务",
  running: "AI 分析中",
  summarizing: "汇总结果",
  done: "已完成",
  failed: "失败",
};

const ETA_HINT = {
  upload: "预计约 1–5 分钟",
  ai_analysis: "预计约 1–3 分钟",
  report: "预计约 1 分钟",
};

const PAGE_SIZE = 5;
const DOCK_CACHE_PREFIX = "ql.task-dock:";

function progressOf(job) {
  if (job.status === "done" || job.status === "partial") return 100;
  const value = Number(job.progress) || 0;
  return Math.max(0, Math.min(100, value));
}

function isActive(job) {
  return job.status === "queued" || job.status === "running";
}

function isUrgent(job) {
  return isActive(job) || job.status === "failed";
}

function ActivityIcon({ size = 16 }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8" />
    </svg>
  );
}

function readDockCache(cid) {
  if (!cid || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${DOCK_CACHE_PREFIX}${cid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeDockCache(cid, next) {
  if (!cid || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`${DOCK_CACHE_PREFIX}${cid}`, JSON.stringify(next));
  } catch {
    // 会话缓存写失败不影响任务展示
  }
}

/**
 * 右侧悬浮任务坞（portal 到 body，避开全局 aside 样式）。
 * 默认收成角标；用户手动展开；列表分页，每页 PAGE_SIZE 条。
 * 展开态与页码记在 sessionStorage（标签页会话内），任务数据仍走底稿内存短 TTL。
 */
export function TaskList({ data, onRetry, onCancel }) {
  const cid = data?.customer?.id || "";
  const cached = useMemo(() => readDockCache(cid), [cid]);

  const jobs = useMemo(
    () =>
      (data.jobs || [])
        .filter((job) =>
          ["queued", "running", "failed", "partial", "done"].includes(job.status),
        )
        .sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a))),
    [data.jobs],
  );

  const activeCount = jobs.filter(isActive).length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const hasUrgent = activeCount > 0 || failedCount > 0;
  const pageCount = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));

  const [open, setOpen] = useState(() => Boolean(cached?.open));
  const [page, setPage] = useState(() => {
    const saved = Number(cached?.page) || 1;
    return Math.max(1, saved);
  });
  const [cancelling, setCancelling] = useState("");

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    writeDockCache(cid, { open, page });
  }, [cid, open, page]);

  if (!jobs.length || typeof document === "undefined") return null;

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = jobs.slice(start, start + PAGE_SIZE);
  const summary =
    activeCount > 0
      ? `${activeCount} 项进行中`
      : failedCount > 0
        ? `${failedCount} 项失败`
        : `${jobs.length} 项任务`;

  async function cancel(jobId) {
    setCancelling(jobId);
    try {
      await onCancel?.(jobId);
    } finally {
      setCancelling("");
    }
  }

  return createPortal(
    <div
      className={`task-dock${open ? " is-open" : ""}${hasUrgent ? " has-urgent" : ""}`}
      aria-label="后台任务"
    >
      {!open ? (
        <button
          type="button"
          className="task-dock-fab"
          onClick={() => setOpen(true)}
          title="查看后台任务"
          aria-expanded="false"
        >
          <ActivityIcon size={15} />
          <span>任务</span>
          {(activeCount > 0 || failedCount > 0) && (
            <em
              className={`task-dock-badge${failedCount && !activeCount ? " is-fail" : ""}`}
            >
              {activeCount > 0 ? activeCount : failedCount}
            </em>
          )}
        </button>
      ) : (
        <section className="task-dock-panel">
          <header className="task-dock-head">
            <div>
              <strong>后台任务</strong>
              <span className="task-dock-summary">{summary}</span>
            </div>
            <button
              type="button"
              className="ghost task-dock-collapse"
              onClick={() => setOpen(false)}
              aria-label="收起任务面板"
            >
              收起
            </button>
          </header>

          <div className="task-dock-body">
            {visible.map((job) => {
              const active = isActive(job);
              const done = job.status === "done" || job.status === "partial";
              const percent = progressOf(job);
              return (
                <div
                  className={`task${active ? " is-active" : ""}${done ? " is-done" : ""}${
                    job.status === "failed" ? " is-failed" : ""
                  }`}
                  key={job.id}
                >
                  <div className="task-head">
                    <span className="task-title">
                      {KIND_LABEL[job.kind] || "后台任务"} · {job.message}
                    </span>
                    <StatusBadge>{JOB_STATUS[job.status]}</StatusBadge>
                  </div>
                  {(active || job.status === "failed") && (
                    <div
                      className={`task-progress ${job.status === "failed" ? "is-failed" : ""}`}
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="任务进度"
                    >
                      <div
                        className="task-progress-bar"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                  {(active || job.status === "failed") && (
                    <div className="task-meta">
                      <span>
                        {job.status === "queued" && job.queue_position > 1
                          ? `排队中 · 前面还有 ${job.queue_position - 1} 份`
                          : STAGE_LABEL[job.stage] || JOB_STATUS[job.status]}
                        {active ? ` · ${ETA_HINT[job.kind] || "预计稍候完成"}` : ""}
                      </span>
                      <span>{percent}%</span>
                    </div>
                  )}
                  {(active || job.status === "failed") && (
                    <div className="task-actions">
                      {active && (
                        <button
                          type="button"
                          className="ghost task-cancel"
                          disabled={cancelling === job.id}
                          onClick={() => void cancel(job.id)}
                        >
                          {cancelling === job.id ? "终止中…" : "终止"}
                        </button>
                      )}
                      {job.status === "failed" &&
                        job.kind === "upload" &&
                        !data.busy && (
                          <Form success="" onSave={() => onRetry(job.id)}>
                            <button type="submit">重试</button>
                          </Form>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="task-dock-pager" role="navigation" aria-label="任务翻页">
              <button
                type="button"
                className="ghost"
                disabled={safePage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </button>
              <span className="task-dock-page">
                {safePage} / {pageCount}
              </span>
              <button
                type="button"
                className="ghost"
                disabled={safePage >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                下一页
              </button>
            </div>
          )}
        </section>
      )}
    </div>,
    document.body,
  );
}
