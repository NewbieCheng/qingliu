UPDATE t_user SET email='admin@qingliu.local', updated_at=UTC_TIMESTAMP() WHERE email='admin' AND account_type=1 AND tenant_id=0 AND status=1;
UPDATE t_user SET email='reviewer01@qingliu.local', updated_at=UTC_TIMESTAMP() WHERE email='reviewer01' AND account_type=1 AND tenant_id=0 AND status=1;
UPDATE t_user SET email='sales01@qingliu.local', updated_at=UTC_TIMESTAMP() WHERE email='sales01' AND account_type=1 AND tenant_id=0 AND status=1;
UPDATE t_user SET email='sales02@qingliu.local', updated_at=UTC_TIMESTAMP() WHERE email='sales02' AND account_type=1 AND tenant_id=0 AND status=1;
SELECT user_id,email,tenant_id,account_type,role_code,status FROM t_user WHERE user_id IN (27,28,29,30);
