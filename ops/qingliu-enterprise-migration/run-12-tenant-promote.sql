INSERT INTO t_tenant(tenant_name,tenant_code,status,plan_code,byok_enabled,created_at,updated_at)
VALUES('清流运营','qingliu-ops',1,'free',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
SET @T = LAST_INSERT_ID();
UPDATE t_user SET tenant_id=@T, account_type=2, role_code=2, updated_at=UTC_TIMESTAMP()
WHERE email='admin@qingliu.local' AND tenant_id=0 AND account_type=1 AND status=1;
UPDATE t_user SET tenant_id=@T, account_type=2, role_code=1, updated_at=UTC_TIMESTAMP()
WHERE email IN ('reviewer01@qingliu.local','sales01@qingliu.local','sales02@qingliu.local')
  AND tenant_id=0 AND account_type=1 AND status=1;
SELECT @T AS new_tenant_id;
SELECT user_id,email,tenant_id,account_type,role_code,status FROM t_user WHERE user_id IN (27,28,29,30);
