-- 003-tenant-isolation：团队 / 个人资料隔离
--
-- 复用工作台已有的租户模型（t_user.tenant_id + t_tenant），不另造一套
-- 「工作空间」概念：用户身上直接带 tenant_id，>0 = 公司团队，0 = 个人。
--
-- 关键语义（与 Store.scopeWhere 一致）：
--   团队账号   tenant_id > 0  → 能看整个团队的资料
--   个人账号   tenant_id = 0  → 只能看自己创建的资料（个人本身就是他的空间）
--   管理员     同样受限 —— 之前 role=="admin" 无条件放行是本次要修的漏洞
--
-- 默认团队「今天不加班」= 工作台 t_tenant.tenant_id = 1，由工作台侧先行创建。
-- 本脚本可重复执行（用 information_schema 判断列是否已存在）。

-- 1) 用户带上租户。
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_users' AND column_name = 'tenant_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE ql_users ADD COLUMN tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''0=个人，>0=工作台 t_tenant.tenant_id'', ADD COLUMN tenant_role VARCHAR(16) NOT NULL DEFAULT '''', ADD KEY idx_users_tenant (tenant_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 客户带上租户与创建者。owner_user_id 只用于审计与个人空间判定。
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_customers' AND column_name = 'workspace_tenant_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE ql_customers ADD COLUMN workspace_tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''资料所属租户，0=个人空间'', ADD COLUMN owner_user_id CHAR(32) NOT NULL DEFAULT '''', ADD KEY idx_customers_tenant (workspace_tenant_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) 回填 owner_user_id：取已有授权关系里最早的那个人。
UPDATE ql_customers c
JOIN (SELECT customer_id, MIN(user_id) AS uid FROM ql_grants GROUP BY customer_id) g
  ON g.customer_id = c.id
SET c.owner_user_id = g.uid
WHERE c.owner_user_id = '';

-- 4) 回填租户：跟随创建者当前所属的租户（个人用户保持 0）。
UPDATE ql_customers c
JOIN ql_users u ON u.id = c.owner_user_id
SET c.workspace_tenant_id = u.tenant_id
WHERE c.workspace_tenant_id = 0 AND u.tenant_id > 0;

-- 5) 既有账号归属默认团队「今天不加班」（tenant 1）。
--    依据：工作台 t_tenant.tenant_id=1 就是这家公司，清流现存账号全部是
--    这家公司的运营人员。新注册的个人账号 tenant_id 保持 0，走个人空间。
UPDATE ql_users SET tenant_id = 1, tenant_role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'member' END
WHERE tenant_id = 0 AND username IN ('admin') ;

-- 6) 关键：第 5 步把既有账号挪进团队后，他们名下的资料必须跟着走。
--    否则会出现「账号在团队 1、资料还在 0」——管理员登录后看不到自己的历史客户。
UPDATE ql_customers c
JOIN ql_users u ON u.id = c.owner_user_id
SET c.workspace_tenant_id = u.tenant_id
WHERE c.workspace_tenant_id <> u.tenant_id;

-- 7) 创建者已被删除的资料归到默认团队，避免变成谁都看不见、也删不掉的孤儿。
UPDATE ql_customers c
SET c.workspace_tenant_id = 1
WHERE c.owner_user_id NOT IN (SELECT id FROM ql_users) AND c.workspace_tenant_id = 0;
