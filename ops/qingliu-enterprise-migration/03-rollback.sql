-- 回滚脚本（任何一步红灯时用; 按需分段执行, 不必整文件一次跑完）
-- 工作台测试库: 用备份表把4人写回个人状态
/*
START TRANSACTION;
UPDATE t_user u JOIN _bak_t_user_qlmig b ON b.user_id=u.user_id
  SET u.email=b.email, u.tenant_id=b.tenant_id, u.account_type=b.account_type,
      u.role_code=b.role_code, u.updated_at=UTC_TIMESTAMP();
DELETE ur FROM t_user_role ur JOIN t_user u ON u.user_id=ur.user_id
  WHERE u.email LIKE '%@qingliu.local';
-- t_user_service: 用备份表同理按(user_id,service_code)覆盖写回
-- 新建的空企业可留着(无成员无害), 或: UPDATE t_tenant SET status=0 WHERE tenant_code='qingliu-ops';
COMMIT;
*/
-- 清流测试库: 用备份表按id覆盖写回
/*
START TRANSACTION;
UPDATE ql_users u JOIN _bak_ql_users_qlmig b ON b.id=u.id
  SET u.username=b.username, u.display=b.display, u.role=b.role,
      u.tenant_id=b.tenant_id, u.tenant_role=b.tenant_role;
UPDATE ql_customers c JOIN _bak_ql_customers_qlmig b ON b.id=c.id
  SET c.workspace_tenant_id=b.workspace_tenant_id;
COMMIT;
*/
-- 回滚后同样 DELETE FROM ql_sessions 踢掉已发会话, 4人用旧凭证+个人登录恢复
SELECT 1;
