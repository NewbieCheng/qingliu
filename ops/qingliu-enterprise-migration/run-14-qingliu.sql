UPDATE ql_users SET username='admin@qingliu.local', display='管理员',
  role='admin', tenant_id=2, tenant_role='admin' WHERE username='admin';
UPDATE ql_users SET username='reviewer01@qingliu.local', display='复核员一',
  role='reviewer', tenant_id=2, tenant_role='member' WHERE username='reviewer01';
UPDATE ql_users SET username='sales01@qingliu.local', display='业务员一',
  role='sales', tenant_id=2, tenant_role='member' WHERE username='sales01';
UPDATE ql_users SET username='sales02@qingliu.local', display='业务员二',
  role='sales', tenant_id=2, tenant_role='member' WHERE username='sales02';
UPDATE ql_customers c JOIN ql_users u ON u.id=c.owner_user_id
  SET c.workspace_tenant_id=2 WHERE u.username LIKE '%@qingliu.local';
DELETE FROM ql_sessions WHERE user_id IN (SELECT id FROM ql_users WHERE tenant_id=2);
SELECT id,username,display,role,tenant_id,tenant_role FROM ql_users WHERE tenant_id=2;
SELECT workspace_tenant_id,COUNT(*) FROM ql_customers GROUP BY 1;
