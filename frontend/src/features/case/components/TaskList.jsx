import React from "react";
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

// 只有进行中的任务显示进度条；失败时保留失败前的位置，完成时是 100%。
function progressOf(job) {
  if (job.status === "done" || job.status === "partial") return 100;
  const value = Number(job.progress) || 0;
  return Math.max(0, Math.min(100, value));
}

export function TaskList({ data, onRetry }) {
  const jobs = data.jobs.filter((job) =>
    ["queued", "running", "failed", "partial", "done"].includes(job.status),
  );
  if (!jobs.length) return null;

  return (
    <section className="task-list card">
      <h3>后台任务</h3>
      {jobs.slice(0, 10).map((job) => {
        const active = job.status === "queued" || job.status === "running";
        const percent = progressOf(job);
        return (
          <div className={`task ${active ? "is-active" : ""}`} key={job.id}>
            <div className="task-head">
              <span>
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
                <div className="task-progress-bar" style={{ width: `${percent}%` }} />
              </div>
            )}
            {(active || job.status === "failed") && (
              <div className="task-meta">
                <span>
                  {job.status === "queued" && job.queue_position > 1
                    ? `排队中 · 前面还有 ${job.queue_position - 1} 份`
                    : STAGE_LABEL[job.stage] || JOB_STATUS[job.status]}
                </span>
                <span>{percent}%</span>
              </div>
            )}
            {job.status === "failed" && job.kind === "upload" && !data.busy && (
              <Form success="" onSave={() => onRetry(job.id)}>
                <button>重试</button>
              </Form>
            )}
          </div>
        );
      })}
    </section>
  );
}
