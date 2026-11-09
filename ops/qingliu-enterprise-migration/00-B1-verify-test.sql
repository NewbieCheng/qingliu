-- B1 现状核实（测试库，只读）
-- 先跑本文件，把结果保存：迁移脚本里的变量都要从这里填。

-- ===== 工作台测试库 =====
SELECT user_id,email,phone,tenant_id,account_type,role_code,status,display_name
FROM t_user WHERE email IN ('admin','reviewer01','sales01','sales02');
-- 期望: 4行, tenant_id=0, account_type=1, status=1

SELECT user_id,service_code,service_role,status
FROM t_user_service WHERE service_code='qingliu';
-- 期望: 4人都有行, service_role=admin/reviewer/sales/sales

SELECT tenant_id,tenant_name,tenant_code,status FROM t_tenant;
SELECT version,dirty FROM schema_migrations;
SELECT provider_code,model_code,task_type,status
FROM t_model_pricing WHERE model_code='deepseek-flash';
-- 期望: 至少一行 task_type='page-ocr' 且启用, 记下 provider_code 给A用

-- 4人个人积分余额(期望全0; 非0先停, 积分搬迁另写ledger)
SELECT owner_id,points_balance FROM t_account_balance
WHERE owner_type='user' AND owner_id IN (
  SELECT user_id FROM t_user WHERE email IN ('admin','reviewer01','sales01','sales02'));

-- ===== 清流测试库 =====
SELECT id,username,display,role,tenant_id,tenant_role,active FROM ql_users
WHERE username IN ('admin','reviewer01','sales01','sales02');
SELECT workspace_tenant_id,COUNT(*) FROM ql_customers GROUP BY 1;
SELECT user_id,workbench_user_id,email,service_role FROM ql_workbench_accounts;
