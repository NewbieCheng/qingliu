-- 002-job-progress.sql
-- 目的：上传/解析任务向用户展示真实百分比进度，降低等待焦虑。
-- 执行前：备份数据库；重复执行会报 Duplicate column name，先确认列不存在。

ALTER TABLE ql_jobs
  ADD COLUMN progress INT NOT NULL DEFAULT 0 AFTER message,
  ADD COLUMN stage VARCHAR(32) NOT NULL DEFAULT '' AFTER progress;

-- AI 辅助分析的阶段进度（展示用）。与 ql_jobs 同步加上。
ALTER TABLE ql_ai_analyses
  ADD COLUMN progress INT NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN stage VARCHAR(32) NOT NULL DEFAULT 'uploading' AFTER progress;

-- 上传批次幂等键：网络失败后重试同一批次不会重复建任务。
ALTER TABLE ql_jobs
  ADD COLUMN upload_batch VARCHAR(64) NOT NULL DEFAULT '' AFTER stage,
  ADD INDEX idx_ql_jobs_batch (customer_id, upload_batch);

-- 上传批次幂等记录：同一 customer+batch 重复提交直接回放原结果。
CREATE TABLE IF NOT EXISTS ql_upload_batches (
    customer_id CHAR(32) NOT NULL,
    batch CHAR(64) NOT NULL,
    payload JSON NOT NULL,
    created TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY(customer_id, batch),
    FOREIGN KEY(customer_id) REFERENCES ql_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB;
