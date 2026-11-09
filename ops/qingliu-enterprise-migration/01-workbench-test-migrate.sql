-- 迁移脚本·工作台测试库（事务执行, 一步一行, ROW_COUNT不对就 ROLLBACK）
-- 前提: 00-B1 已确认4行全在 (tenant 0 / type 1 / status 1), 积分全0
-- 伪造邮箱 (纯登录凭证, .local不收发邮件):
--   admin->admin@qingliu.local, reviewer01->reviewer01@qingliu.local,
--   sales01->sales01@qingliu.local, sales02->sales02@qingliu.local

START TRANSACTION;
CREATE TABLE IF NOT EXISTS _bak_t_user_qlmig AS SELECT * FROM t_user WHERE 1=0;
CREATE TABLE IF NOT EXISTS _bak_t_user_service_qlmig AS SELECT * FROM t_user_service WHERE 1=0;
INSERT INTO _bak_t_user_qlmig SELECT * FROM t_user
  WHERE email IN ('admin','reviewer01','sales01','sales02');
INSERT INTO _bak_t_user_service_qlmig SELECT * FROM t_user_service
  WHERE service_code='qingliu' AND user_id IN (SELECT user_id FROM _bak_t_user_qlmig);

UPDATE t_user SET email='admin@qingliu.local', updated_at=UTC_TIMESTAMP()
WHERE email='admin' AND account_type=1 AND tenant_id=0 AND status=1;
-- ROW_COUNT必须=1
UPDATE t_user SET email='reviewer01@qingliu.local', updated_at=UTC_TIMESTAMP()
WHERE email='reviewer01' AND account_type=1 AND tenant_id=0 AND status=1;
-- ROW_COUNT必须=1
UPDATE t_user SET email='sales01@qingliu.local', updated_at=UTC_TIMESTAMP()
WHERE email='sales01' AND account_type=1 AND tenant_id=0 AND status=1;
-- ROW_COUNT必须=1
UPDATE t_user SET email='sales02@qingliu.local', updated_at=UTC_TIMESTAMP()
WHERE email='sales02' AND account_type=1 AND tenant_id=0 AND status=1;
-- ROW_COUNT必须=1

INSERT INTO t_tenant(tenant_name,tenant_code,status,plan_code,byok_enabled,created_at,updated_at)
VALUES('清流运营','qingliu-ops',1,'free',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
SET @T = LAST_INSERT_ID();

UPDATE t_user SET tenant_id=@T, account_type=2, role_code=2, updated_at=UTC_TIMESTAMP()
WHERE email='admin@qingliu.local' AND tenant_id=0 AND account_type=1 AND status=1;
-- ROW_COUNT必须=1
UPDATE t_user SET tenant_id=@T, account_type=2, role_code=1, updated_at=UTC_TIMESTAMP()
WHERE email IN ('reviewer01@qingliu.local','sales01@qingliu.local','sales02@qingliu.local')
  AND tenant_id=0 AND account_type=1 AND status=1;
-- ROW_COUNT必须=3

INSERT INTO t_user_service(user_id,service_code,service_role,status,created_at,updated_at)
SELECT u.user_id,'qingliu',
  CASE WHEN u.email='admin@qingliu.local' THEN 'admin'
       WHEN u.email LIKE 'reviewer%' THEN 'reviewer' ELSE 'sales' END,
  1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)
FROM t_user u WHERE u.tenant_id=@T
ON DUPLICATE KEY UPDATE updated_at=UTC_TIMESTAMP(3);

DELETE FROM t_user_role WHERE user_id IN (SELECT user_id FROM t_user WHERE tenant_id=@T)
  AND tenant_id IN (0,@T);
INSERT INTO t_user_role(user_id,role_id,tenant_id)
SELECT u.user_id, r.role_id, @T FROM t_user u
JOIN t_role r ON r.scope=2 AND r.tenant_id=0 AND r.is_system=1
  AND r.role_code = CASE WHEN u.role_code=2 THEN 'enterprise_admin' ELSE 'enterprise_member_full' END
WHERE u.tenant_id=@T;
-- 期望4行; 0行也继续(登录时按旧映射自愈), 但要上报

UPDATE t_refresh_token SET revoked_at=UTC_TIMESTAMP(3)
WHERE user_id IN (SELECT user_id FROM t_user WHERE tenant_id=@T) AND revoked_at IS NULL;
COMMIT;
SELECT @T AS new_tenant_id;
-- 把输出的 new_tenant_id 填进 02 脚本的 @T
