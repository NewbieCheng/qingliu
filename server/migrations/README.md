# 数据库迁移

`schema.sql` 使用 `CREATE TABLE IF NOT EXISTS` 启动建表，只能为新库创建索引/列，
**不会给已有生产表补索引或加列**。任何字段/索引变更都必须在本目录增加按版本命名的 SQL，
并在**发布流程里执行**（不是可选步骤）。

## 全部迁移（按编号顺序，全部幂等）

| 文件 | 内容 | 备注 |
|---|---|---|
| `001-audit-indexes.sql` | `ql_events` 的分页与筛选索引 | |
| `002-job-progress.sql` | 任务进度列 | |
| `003-tenant-isolation.sql` | 资料归属（`ql_customers.workspace_tenant_id`） | |
| `004-session-space.sql` | 会话空间坐标 + 工作台权限快照 | 后被 005 改写为 `space_kind/space_id` |
| `005-drop-local-space-columns.sql` | 加 `ql_sessions/ql_jobs.space_kind/space_id`，删清流自有的空间列 | **必须执行**，否则新版二进制每个请求都会 1054 报错 |

## 上线顺序（顺序不能换）

1. 备份数据库：
   ```bash
   mysqldump --single-transaction --no-tablespaces --triggers "$DB" | gzip > /var/backups/qingliu/premig-$(date -u +%Y%m%d-%H%M%S).sql.gz
   ```
   （不带 `--no-tablespaces` 会因缺 `PROCESS` 权限报错并可能写出不完整的备份）
2. **执行迁移 SQL**（应用账号只有 SELECT/INSERT/UPDATE/DELETE/CREATE/INDEX/REFERENCES，
   **没有 ALTER**，必须用 root 执行）：
   ```bash
   mysql -uroot "$DB" < server/migrations/00N-xxx.sql
   ```
3. 部署新二进制与前端（见 `docs/05-部署与服务器.md`）
4. 验证：打开 `/profile` 与 `/admin`，确认没有「处理失败，请联系管理员」

## 踩过的坑（2026-11-10）

发布新版二进制时**漏执行 005**：`schema.sql` 用 `IF NOT EXISTS`，已存在的表不会补列，
于是 `SELECT ... s.space_kind ... FROM ql_sessions` 直接 1054，
整站每个带登录态的请求都返回 `{"error":"处理失败，请联系管理员"}`。
补跑 005 后立即恢复 —— 迁移不是「重建库时才需要」的东西。
