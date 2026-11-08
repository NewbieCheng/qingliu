-- 001-audit-indexes.sql
-- 目的：支撑 /api/admin/audit 的分页与筛选，避免全表排序。
-- 执行前：备份数据库；确认索引尚不存在。
-- MySQL 8.0 不支持 CREATE INDEX IF NOT EXISTS，重复执行会报 Duplicate key name。

ALTER TABLE ql_events
  ADD INDEX idx_ql_events_user_seq (user_id, seq),
  ADD INDEX idx_ql_events_action_seq (action, seq),
  ADD INDEX idx_ql_events_created_seq (created, seq);
