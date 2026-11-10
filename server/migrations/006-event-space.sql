-- 006-event-space：操作记录按空间隔离
--
-- 背景：GET /api/admin/audit 之前不过滤空间，管理员能看到所有人、所有空间的
-- 操作（含别人的登录）。资料列表早已按会话空间收口，审计却漏了，形成越权。
--
-- 修法：
--   1) ql_events 增加 space_kind / space_id（与会话、任务同一套坐标）
--   2) 写入时带上当前空间
--   3) 查询按当前空间过滤：团队看本团队全部；个人/平台只看自己
--
-- 本脚本可重复执行。

SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_events' AND column_name = 'space_kind');
SET @sql := IF(@has = 0,
  'ALTER TABLE ql_events ADD COLUMN space_kind VARCHAR(16) NOT NULL DEFAULT ''personal'' COMMENT ''事件发生时所在空间：personal|team|platform'', ADD COLUMN space_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''团队/平台空间 id；个人空间为 0'', ADD INDEX idx_events_space_seq (space_kind, space_id, seq)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 回填：有客户的事件跟资料归属走。
UPDATE ql_events e
JOIN ql_customers c ON c.id = e.customer_id
SET e.space_kind = IF(c.workspace_tenant_id > 0, 'team', 'personal'),
    e.space_id = IF(c.workspace_tenant_id > 0, c.workspace_tenant_id, 0)
WHERE e.customer_id IS NOT NULL AND e.customer_id <> '';

-- 回填：登录/切空间/开启空间的 detail 形如 kind:id。
UPDATE ql_events
SET space_kind = CASE
      WHEN LOWER(SUBSTRING_INDEX(detail, ':', 1)) IN ('team', 'enterprise') THEN 'team'
      WHEN LOWER(SUBSTRING_INDEX(detail, ':', 1)) = 'platform' THEN 'platform'
      ELSE 'personal'
    END,
    space_id = CASE
      WHEN LOWER(SUBSTRING_INDEX(detail, ':', 1)) IN ('team', 'enterprise', 'platform')
        THEN CAST(SUBSTRING_INDEX(detail, ':', -1) AS UNSIGNED)
      ELSE 0
    END
WHERE action IN ('login', 'switch_space', 'enable_space')
  AND detail LIKE '%:%'
  AND space_kind = 'personal'
  AND space_id = 0;
