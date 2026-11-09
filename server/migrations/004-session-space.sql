-- 004-session-space：会话带空间 + 工作台权限快照
--
-- 背景（本轮要修的两处冲突）：
--
-- A. 「团队」有两个真相。ql_users.tenant_id 在**登录时**定死为工作台返回的
--    那一个，而一个人在工作台可能同时属于多个企业（或者同时有个人空间）。
--    于是「切换空间」在清流里根本不存在：切不了，等于没有。
--    修法：把「这个会话当前处在哪个空间」放到 ql_sessions 上，由
--    POST /api/switch-space 改写；scopeWhere 读会话而不是读用户那一列。
--
-- B. 权限冗余且会降级。ql_users.role 是清流自己的三档字符串，而工作台的
--    RBAC 是权限码。wbUpsertLocalUser 把「不认识的角色」一律降级成 sales，
--    于是工作台上的 enterprise_member_readonly（只读成员）在清流里能改资料。
--    修法：登录时把工作台权限快照存进 ql_workbench_accounts.permissions，
--    判定改为「快照里有这个权限」；ql_users.role 降级为默认值/兜底。
--
-- 本脚本可重复执行（用 information_schema 判断列是否已存在）。

-- 1) 会话空间。0 = 个人空间（沿用 ql_users.tenant_id 的历史含义）。
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_sessions' AND column_name = 'tenant_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE ql_sessions ADD COLUMN tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''本会话所在空间，0=个人空间''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 权限快照。JSON 数组，元素是工作台的 permission_code（如 qingliu.admin）。
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_workbench_accounts' AND column_name = 'permissions');
SET @sql := IF(@has = 0,
  'ALTER TABLE ql_workbench_accounts ADD COLUMN permissions JSON NULL COMMENT ''工作台权限码快照''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) 回填：既有会话沿用用户当前所属的租户，行为与迁移前完全一致。
UPDATE ql_sessions s
JOIN ql_users u ON u.id = s.user_id
SET s.tenant_id = u.tenant_id
WHERE s.tenant_id = 0 AND u.tenant_id > 0;
