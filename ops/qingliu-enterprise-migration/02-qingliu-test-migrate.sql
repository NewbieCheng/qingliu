-- 迁移脚本·清流测试库（事务执行）
-- 前提: 01已提交, @T=上面输出的 new_tenant_id, 填到下面第1行

SET @T = 0; -- TODO: 改成01输出的 new_tenant_id, 改完再整体执行

START TRANSACTION;
CREATE TABLE IF NOT EXISTS _bak_ql_users_qlmig AS SELECT * FROM ql_users WHERE 1=0;
CREATE TABLE IF NOT EXISTS _bak_ql_customers_qlmig AS SELECT * FROM ql_customers WHERE 1=0;
INSERT INTO _bak_ql_users_qlmig SELECT * FROM ql_users
  WHERE username IN ('admin','reviewer01','sales01','sales02');

UPDATE ql_users SET username='admin@qingliu.local', display='管理员',
  role='admin', tenant_id=@T, tenant_role='admin' WHERE username='admin';
-- ROW_COUNT必须=1
UPDATE ql_users SET username='reviewer01@qingliu.local', display='复核员一',
  role='reviewer', tenant_id=@T, tenant_role='member' WHERE username='reviewer01';
-- ROW_COUNT必须=1
UPDATE ql_users SET username='sales01@qingliu.local', display='业务员一',
  role='sales', tenant_id=@T, tenant_role='member' WHERE username='sales01';
-- ROW_COUNT必须=1
UPDATE ql_users SET username='sales02@qingliu.local', display='业务员二',
  role='sales', tenant_id=@T, tenant_role='member' WHERE username='sales02';
-- ROW_COUNT必须=1

-- 只搬这4人名下的资料, 不动租户1里别人的东西
INSERT INTO _bak_ql_customers_qlmig
  SELECT c.* FROM ql_customers c JOIN ql_users u ON u.id=c.owner_user_id
  WHERE u.username LIKE '%@qingliu.local';
UPDATE ql_customers c JOIN ql_users u ON u.id=c.owner_user_id
  SET c.workspace_tenant_id=@T WHERE u.username LIKE '%@qingliu.local';

DELETE FROM ql_sessions WHERE user_id IN (SELECT id FROM ql_users WHERE tenant_id=@T);
COMMIT;

-- 验证 (事务外跑):
SELECT id,username,display,role,tenant_id,tenant_role FROM ql_users
WHERE username LIKE '%@qingliu.local';
SELECT workspace_tenant_id,COUNT(*) FROM ql_customers GROUP BY 1;
