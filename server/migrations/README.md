# 数据库迁移

`schema.sql` 使用 `CREATE TABLE IF NOT EXISTS` 启动建表，只能为新库创建索引，
不会给已有生产表补索引。涉及索引、字段的变更必须在本目录增加按版本命名的 SQL，
并在发布流程中由人工确认后执行；执行前先备份数据库。

当前待执行迁移：

- `001-audit-indexes.sql`：为 `ql_events` 的分页、按成员/动作/时间筛选补索引

上线顺序：

1. 备份数据库
2. 执行迁移 SQL
3. `SHOW INDEX FROM ql_events` 确认索引存在
4. 部署新二进制与前端
5. 打开 `/admin`，验证操作记录分页、筛选和刷新
