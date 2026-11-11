# 清流项目工作区约定

面向内部客户资料与流水初筛的单体应用（一个 Go 进程同时承载 API + React 静态资源，无 Node 常驻）。
**账号真相在工作台**：登录/计费/支付全部经 `WORKBENCH_BASE_URL` 代理，本仓不建独立账号支付库。

## 一、技术栈与边界
- **前端**：React 19 + Vite 7，原生 CSS，ESM JavaScript（不上 TS，不引任何 UI/路由/状态/请求库，包管理 pnpm）。
- **后端**：Go 1.26 + 标准库 `net/http`（不用 Web 框架/ORM）。后台长任务由进程内单执行器处理（`worker.go` + `ql_jobs`），不引 Redis/MQ。
- **存储**：MySQL 8（库 `qingliu`，表前缀 `ql_`，不与工作台共用）；文件存 `DATA_DIR` + QLGO1（AES-256-GCM，`VAULT_KEY`），必须走 Store 读写。
- **产物与凭据**：`frontend/dist` 是构建产物，改源码后必须重新构建；密钥与私钥只存 `.secrets/`，严禁入库。

## 二、部署环境（两套独立库，禁止交叉）
- **生产**：`https://qingliu.bujiaban.top` → 工作台 `https://worker.bujiaban.top`（主机 `115.191.68.41`）。
- **测试**：工作台 `https://worker.no996ai.cn`（主机 `118.196.106.85`）。切换后须重新登录。

## 三、开发与架构约束
- **前端分层（`app → pages → features → shared`）**：
  - `shared` 禁引 `features/pages`；`pages` 禁直连 `fetch` 或引 `shared/api/client.js`。
  - 同 feature 走相对路径；跨 feature 仅引对方 `@/features/<name>/index.js`；页面跳转仅用 `navigate()` / `<Link>`。
  - 业务请求统走 `shared/api/client.js`；查询 TTL 放在 `app/queries/index.js`，列表必须服务端分页；缓存仅存内存，禁写 localStorage。
  - 表单统一 `toast()`；客户底稿四步走 `?step=`；样式优先 `shared/styles/tokens.css`。
- **后端设计**：
  - 路由仅在 `main.go` 的 `mux()` 内注册；中间件顺序固定；错误统一 `bad(code, msg)` / `require(cond, msg)`，禁暴露 SQL 堆栈。
  - 权限判定走 `q.can(code)`，客户级 `q.access()`（无权返回 404 免探测），禁写 `role == "admin"`。
  - 数据全部经 `Store` 参数化查询（`?`），严禁拼接 SQL；关键写操作记录 `s.event(...)`；报告签发后为不可变快照。
  - **请求里禁止无限期阻塞**：准入按代价分档（`server/pool.go`：read 64 / write 32 / proxy 32 / bulk 2 / render 4，`/health` 与静态资源**不入池**，满档先排队再 503 + `Retry-After`）。任何一档被长期占满，该档接口就会持续 503 而进程仍 active；单飞/互斥 gate 一律 `defer` 收尾（含 panic 路径），等待方一律 `select` + 超时。禁止退回「全站一个池」。案例见 [05 §11](docs/05-部署与运维.md)、[05 §12](docs/05-部署与运维.md)。
  - **空间是会话属性**：`ql_sessions.space_kind/space_id` 为唯一准则，切换走 `POST /api/switch-space`。
- **数据库与构建**：
  - `schema.sql` 仅用于新库；已有库改字段在 `server/migrations/` 加幂等 `NNN-xxx.sql`，上线由 root 手动执行（应用账号无 ALTER 权限）。
  - 本地构建：Windows 缓存配置 `GOCACHE=$PWD/.gocache`；权限收紧走 `umask_windows.go`。
  - 验证命令：后端 `cd server && go test ./... && go vet ./...`；前端 `cd frontend && pnpm check`（跑 lint/边界/测试/构建）。

## 四、十一项严令红线
1. ❌ 在清流里另建账号/支付/订单库，或绕开工作台改计费。
2. ❌ 引入 Redis、消息队列或第二个常驻服务。
3. ❌ 恢复单文件大组件，或把业务逻辑塞回 `pages`。
4. ❌ 页面直接 `fetch` 或直接 import `shared/api/client.js`。
5. ❌ 前端缓存写 localStorage，或用于资金/权限最终裁决。
6. ❌ 字符串拼接 SQL；绕过 Store 直接读写文件。
7. ❌ 真实密钥、服务器密码、客户资料写入代码或提交。
8. ❌ 自动 `git commit` / `push` / 部署生产（须业主明确指令）。
9. ❌ 提交 `node_modules`、无关的 `dist`、`.env.local`、`.secrets/`。
10. ❌ 未经确认改动接口契约、状态码、Cookie/CSRF 机制。
11. ❌ 对同一用户无锁并发 `wbRefresh`（工作台 token 刷新并发复用会吊销 family，见 [02 §5.1](docs/02-后端开发.md)）。单飞 gate 必须 `defer` 销号 + `close(gate.done)`（panic 也要），等待方必须带超时 —— 漏一个 `close` 就是**该档准入被占死**（2026-11-12 生产事故，见 [05 §11](docs/05-部署与运维.md)）。同时禁止把请求准入退回「全站一个 4 槽池」（[05 §12](docs/05-部署与运维.md)）。

## 五、开工流程与交付
1. **读**：本文与 `docs/00-项目总览.md` → 2. **定位**：代码与符号查询优先用 CodeGraph（`codegraph query/explore/node/callers`）定位符号与调用链，不凭猜改文件 → 3. **复述**：确认需求与改动清单 → 4. **最小改动**：只改点名处 → 5. **自检**：跑第 `三` 节验证命令 → 6. **交付**：如实说明修改范围与验证状态。默认**只改本地**，不自动提交发布。
核心文档索引：[00-项目总览](docs/00-项目总览.md)、[01-前端开发](docs/01-前端开发.md)、[02-后端开发](docs/02-后端开发.md)、[03-数据模型](docs/03-数据模型.md)、[04-接口清单](docs/04-接口清单.md)、[05-部署与运维](docs/05-部署与运维.md)。
