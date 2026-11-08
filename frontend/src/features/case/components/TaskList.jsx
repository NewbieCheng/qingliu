import React from "react";
import { JOB_STATUS } from "@/shared/lib/constants.js";
import { Form } from "@/shared/ui/Form.jsx";
import { StatusBadge } from "@/shared/ui/Badge.jsx";

export function TaskList({ data, onRetry }) {
  const jobs = data.jobs.filter((job) =>
    ["queued", "running", "failed"].includes(job.status),
  );
  if (!jobs.length) return null;

  return (
    <section className="task-list card">
      <h3>后台任务</h3>
      {jobs.slice(0, 10).map((job) => (
        <div className="task" key={job.id}>
          <span>
            {job.kind === "upload" ? "资料识别" : "报告生成"} · {job.message}
          </span>
          <StatusBadge>{JOB_STATUS[job.status]}</StatusBadge>
          {job.status === "failed" && job.kind === "upload" && !data.busy && (
            <Form success="" onSave={() => onRetry(job.id)}>
              <button>重试</button>
            </Form>
          )}
        </div>
      ))}
    </section>
  );
}
