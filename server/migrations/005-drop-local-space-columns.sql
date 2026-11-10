-- 005-drop-local-space-columns：空间交给工作台，清流只留「会话/任务在哪个空间」
--
-- 背景：工作台把「空间」重构成 kind（personal|team|platform）+ id，并且删掉了
-- JWT 里的 tid/role/acct 三个 claim。清流这边原来的三列是一份**自有**的空间
-- 实现：登录时按 user.tenant_id 定死、只有团队与个人两种、切换还要再写一遍
-- ql_sessions.tenant_id —— 同一件事存在两处，必然分叉（典型症状：界面显示在
-- 团队空间，看到的却是个人资料）。
--
-- 本轮改成两处坐标，且都不叫 tenant_id：
--
--   ql_sessions.space_kind / space_id  —— 这个会话当前在哪个空间（唯一落点）
--   ql_jobs.space_kind / space_id      —— 任务创建时所在的空间
--
-- 为什么任务要自己带：后台任务由 worker 在没有会话的情况下重跑，它必须知道
-- 「这个任务当初是在哪个空间提交的」，否则只能在任务里放宽权限。
--
-- 为什么团队归属**不**放在 ql_users 上：同一个人可以同时属于多个企业，
-- 「他在哪个团队」是成员关系（工作台 t_space_membership），不是账号属性。
-- 清流在用户表上再存一份，就必然出现「账号在 A、会话在 B」的第二种真相。
--
-- 资料归属列 ql_customers.workspace_tenant_id 保留：它记录的是**资料属于哪个
-- 团队**（0 = 个人资料），与会话当前在哪个空间是两件事 —— 团队资料不会因为
-- 有人切到个人空间就改归属。
--
-- 本脚本可重复执行（用 information_schema 判断列/索引是否存在）。

-- 1) 会话空间坐标。
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_sessions' AND column_name = 'space_kind');
SET @sql := IF(@has = 0,
  'ALTER TABLE ql_sessions ADD COLUMN space_kind VARCHAR(16) NOT NULL DEFAULT ''personal'' COMMENT ''本会话所在空间：personal|team|platform（见 migrations/005）'', ADD COLUMN space_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''团队/平台空间 id；个人空间为 0''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 任务空间坐标（后台任务没有会话，必须自己带）。
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_jobs' AND column_name = 'space_kind');
SET @sql := IF(@has = 0,
  'ALTER TABLE ql_jobs ADD COLUMN space_kind VARCHAR(16) NOT NULL DEFAULT ''personal'' COMMENT ''任务提交时所在的空间'', ADD COLUMN space_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''团队空间 id；个人空间为 0''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) 回填会话：老会话的 ql_sessions.tenant_id>0 就是团队空间。这一列在第 5 步
--    才被删，所以这里还读得到；重复执行时它已经不存在，整段跳过。
SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_sessions' AND column_name = 'tenant_id');
SET @sql := IF(@has = 1,
  'UPDATE ql_sessions SET space_kind = IF(tenant_id > 0, ''team'', ''personal''), space_id = tenant_id WHERE space_id = 0',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) 回填任务：任务所在的资料本身已经带着归属（ql_customers.workspace_tenant_id），
--    所以不需要再去问 ql_users —— 这也正好避开「用户列马上要删」的顺序问题。
UPDATE ql_jobs j
JOIN ql_customers c ON c.id = j.customer_id
SET j.space_kind = IF(c.workspace_tenant_id > 0, 'team', 'personal'),
    j.space_id   = c.workspace_tenant_id
WHERE j.space_kind = 'personal' AND j.space_id = 0;

-- 5) 删掉自有的空间列。先删索引：MySQL 不允许删除被索引引用的列。
SET @has := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'ql_users' AND index_name = 'idx_users_tenant');
SET @sql := IF(@has = 1, 'ALTER TABLE ql_users DROP INDEX idx_users_tenant', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_users' AND column_name = 'tenant_id');
SET @sql := IF(@has = 1,
  'ALTER TABLE ql_users DROP COLUMN tenant_id, DROP COLUMN tenant_role',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'ql_sessions' AND column_name = 'tenant_id');
SET @sql := IF(@has = 1, 'ALTER TABLE ql_sessions DROP COLUMN tenant_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
