-- 007-grant-workbench-binding：客户授权绑工作台 user_id
--
-- 背景：清流不再做第二套账号库。ql_grants.user_id 仍指向本地影子行
-- （会话/外键需要），真正「授权给谁」以 workbench_user_id 为准。
-- 团队空间非管理员可见性读本列（见 scopeWhere）。
--
-- 本脚本可重复执行。

SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_grants' AND column_name = 'workbench_user_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE ql_grants ADD COLUMN workbench_user_id BIGINT UNSIGNED NULL COMMENT ''工作台 t_user.id；团队授权可见性按此列判'' AFTER user_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 从工作台绑定回填；未登录过工作台的本地应急账号保持 NULL。
UPDATE ql_grants g
INNER JOIN ql_workbench_accounts w ON w.user_id = g.user_id
SET g.workbench_user_id = w.workbench_user_id
WHERE g.workbench_user_id IS NULL OR g.workbench_user_id = 0;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'ql_grants' AND index_name = 'idx_grants_wb');
SET @sql := IF(@idx = 0,
  'ALTER TABLE ql_grants ADD INDEX idx_grants_wb (customer_id, workbench_user_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
