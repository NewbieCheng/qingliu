INSERT INTO t_user_service(user_id,service_code,service_role,status,created_at,updated_at)
SELECT u.user_id,'qingliu',
  CASE WHEN u.email='admin@qingliu.local' THEN 'admin'
       WHEN u.email LIKE 'reviewer%' THEN 'reviewer' ELSE 'sales' END,
  1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)
FROM t_user u WHERE u.tenant_id=2
ON DUPLICATE KEY UPDATE updated_at=UTC_TIMESTAMP(3);
DELETE FROM t_user_role WHERE user_id IN (27,28,29,30) AND tenant_id IN (0,2);
INSERT INTO t_user_role(user_id,role_id,tenant_id)
SELECT u.user_id, r.role_id, 2 FROM t_user u
JOIN t_role r ON r.scope=2 AND r.tenant_id=0 AND r.is_system=1
  AND r.role_code = CASE WHEN u.role_code=2 THEN 'enterprise_admin' ELSE 'enterprise_member_full' END
WHERE u.user_id IN (27,28,29,30);
UPDATE t_refresh_token SET revoked_at=UTC_TIMESTAMP(3)
WHERE user_id IN (27,28,29,30) AND revoked_at IS NULL;
SELECT s.user_id,s.service_code,s.service_role,s.status FROM t_user_service s WHERE s.user_id IN (27,28,29,30);
SELECT ur.user_id,r.role_code,ur.tenant_id FROM t_user_role ur JOIN t_role r ON r.role_id=ur.role_id WHERE ur.user_id IN (27,28,29,30);
