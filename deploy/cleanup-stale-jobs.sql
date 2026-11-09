-- 清理历史卡死任务（一次性维护脚本，不是迁移）
--
-- 背景：旧版本任务失败时没有写 ql_jobs 终态，记录永久停在 queued，
-- busy() 恒为真，该客户的上传、核对、生成报告全部被 409 挡住。
-- 新版已修（jobStart/jobFinish/sweepStaleJobs），但库里旧数据需要手工清一次。
--
-- 用法（生产库，先看再删）：
--   mysql -h <host> -u <user> -p <db> < deploy/cleanup-stale-jobs.sql
-- 第二段 DELETE 默认被注释掉，确认影响行数后再手动放开。

-- 1) 先看会命中哪些任务（只读）
SELECT id, customer_id, kind, status, stage, progress, created
  FROM ql_jobs
 WHERE status IN ('queued','running')
   AND created < DATE_SUB(NOW(), INTERVAL 30 MINUTE)
 ORDER BY created;

-- 2) 一并看 AI 明细表
SELECT id, customer_id, document_id, status, stage, progress, created
  FROM ql_ai_analyses
 WHERE status IN ('queued','running','uploading')
   AND created < DATE_SUB(NOW(), INTERVAL 30 MINUTE)
 ORDER BY created;

-- 3) 把卡死任务标成失败（保留记录，便于回溯与页面展示「已自动终止」）
UPDATE ql_jobs
   SET status='failed', stage='failed', progress=0,
       message='历史卡死清理：任务超时未完成，已自动终止'
 WHERE status IN ('queued','running')
   AND created < DATE_SUB(NOW(), INTERVAL 30 MINUTE);

UPDATE ql_ai_analyses
   SET status='failed', stage='failed', error='历史卡死清理：任务超时未完成，已自动终止',
       completed=NOW(6)
 WHERE status IN ('queued','running','uploading')
   AND created < DATE_SUB(NOW(), INTERVAL 30 MINUTE);

-- 4) 可选：彻底删除这些历史记录（页面上的红色失败条目也随之消失）
--    默认注释，确认第 1、2 段查出来的行都无用后再放开。
-- DELETE FROM ql_ai_analyses
--  WHERE status='failed' AND error='历史卡死清理：任务超时未完成，已自动终止';
-- DELETE FROM ql_jobs
--  WHERE status='failed' AND message='历史卡死清理：任务超时未完成，已自动终止';
