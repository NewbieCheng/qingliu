# 清流项目工作区约定

本仓库是**清流 Qingliu** 专用开发工作区。本文同时是**交给 AI 的开工前必读硬约束**；规则是硬约束，不是建议。与业主当次口头要求冲突时，先指出冲突点由业主决定，不得自行放宽。

## 一、这是什么项目

清流是面向业务员 / 复核员 / 管理员的**内部客户资料与流水初筛工作台**。

- 不做贷款资格结论，报告仅供内部初筛，不替代银行审批。
- **单体应用**：一个 Go 二进制同时提供 API + React 静态文件；没有 Node 常驻进程、没有第二个服务。
- 登录 / 计费 / 支付订单**全部通过工作台后台**（另一个仓库），本仓库只做代理和界面。

## 二、技术栈（不准换）

| 层 | 选型 | 硬性要求 |
| --- | --- | --- |
| 前端 | React 19 + Vite 7，原生 CSS | **不引入** UI 框架、路由库、状态库、请求库 |
| 前端语言 | JavaScript（`.js` / `.jsx`，ESM） | 不上 TypeScript |
| 后端 | Go 1.26，标准库 `net/http` | **不用** Web 框架，**不用** ORM |
| 数据库 | MySQL 8，库名 `qingliu`，表前缀 `ql_` | 不与工作台共用表 |
| 后台任务 | Go 进程内单执行器 | 不引入 Redis / 消息队列 / 第二个常驻服务 |
| 文件 | `DATA_DIR` + QLGO1（AES-256-GCM，`VAULT_KEY`） | 必须走 Store 读写 |

现有依赖只有 `mysql`、`fpdf`、`excelize`、`x/crypto`、`x/text`、`qrcode`；新增依赖前必须说明理由。包管理器是 **pnpm**（有 `pnpm-lock.yaml`，没有 `package-lock.json`）。

## 三、边界

- 本仓库只维护清流前端和清流 Go 服务；工作台后台是另一个仓库，不在这里改。
- 不要在清流里另建账号、支付或订单库。
- `frontend/dist` 是交付产物，改源码后必须重新构建，不能只改 dist。`bin/` 不提交。
- 服务器信息、密码、`VAULT_KEY`、SSH 私钥只在 `.secrets/` 或密码管理器；不写进文档、提交记录、截图或日志。

## 四、环境（写错会读到错的库）

| 环境 | 清流 | 工作台后端（`WORKBENCH_BASE_URL`） | 服务器 |
|---|---|---|---|
| **生产** | `https://qingliu.bujiaban.top` | `https://worker.bujiaban.top` | `115.191.68.41` |
| **测试** | 尚未单独部署 | `https://worker.no996ai.cn` | `118.196.106.85` |

`bujiaban.top` = 生产，`no996ai.cn` = 测试；两套 MySQL 完全独立，**禁止交叉指向**。切换 `WORKBENCH_BASE_URL` 后必须重新登录（旧 token 属于旧库）。测试后台没有微信支付配置，只有 `manual` 渠道。

## 五、前端架构

分层固定 `app → pages → features → shared`，禁止恢复单文件大组件：

```text
frontend/src/
  main.jsx   只挂载 React
  app/       总装、routes.jsx、登录守卫、ErrorBoundary、queries/
  pages/     页面组合：login clients case recharge profile admin not-found
  features/  业务域：auth clients case billing ai-analysis profile admin
  shared/    api/ router/ layout/ ui/ hooks/ lib/ styles/
```

| 规则 | 违反后果 |
| --- | --- |
| `shared` 不得 import `features` / `pages` | `pnpm check:arch` 直接失败 |
| `pages` 不得 `fetch`，也不得直接 import `shared/api/client.js` | 同上 |
| 同一 feature 内部用**相对路径**；跨 feature 只能引对方 `@/features/<name>/index.js` | 同上 |
| 内部跳转只能用 `navigate()` / `<Link>` | 同上（会整页刷新） |
| 金额/日期/角色名/状态文案只在 `shared/lib` 或 feature `constants.js` 定义一次 | code review 驳回 |
| 图标统一 `shared/ui/icons.jsx`，不用字符拼 | 同上 |

- 所有业务请求经 `shared/api/client.js`；CSRF、401、`ApiError` **只**在这一层处理。
- 查询 key 与 TTL 只在 `app/queries/index.js`，缓存原语只在 `shared/api/cache.js`；列表**必须服务端分页**。
- 写成功后**先失效再刷新**；退出/401/切换空间清空全部缓存。缓存只放内存，**不得**用于资金、权限、报告签发的判断。
- 表单成功/失败统一 `toast()`；需要自定义提示时给 `Form` 传 `success=""`。
- 客户底稿四步走 `?step=` URL；新功能加到对应 step/feature，不要堆回 `CasePage`。
- 新增页面：`pages/<name>/` → 必要时 `features/<domain>/` → `app/routes.jsx` 注册 → 改 `shared/layout/navigation.js`。
- 样式优先 `shared/styles/tokens.css`，保留深松绿/账本纸语言，不引 CSS 框架、不写内联魔法值。390px 不得横向溢出。

## 六、后端约束

| 规则 | 说明 |
| --- | --- |
| 路由 | 只在 `main.go` 的 `mux()` 内 `m.HandleFunc("METHOD /api/...", a.route(...))`，用 `{cid}` 路径变量 |
| 中间件 | `a.route()` 统一处理 panic→JSON、安全头、并发槽位、`MaxBytesReader`、会话 Cookie、401、Origin + `X-CSRF-Token`；**顺序不要动** |
| 错误 | 用 `bad(code, "中文提示")` / `require(cond, msg)`，不 `http.Error`、不裸 500；不暴露 SQL/路径/堆栈 |
| 权限 | 客户级 `q.access()`（无权限返回 **404** 而非 403，避免探测）；管理 `q.admin()`；写数据 `q.edit()`；判定用 `q.can(code)`，**不写 `role == "admin"`** |
| 数据 | 全部经 `Store`（`exec`/`query`/`one`/`lock`/`event`/`write`/`read`）；参数永远用 `?`，**禁止拼接 SQL** |
| 审计 | 关键写操作调 `s.event(...)`；只有 `auditActionCatalog` 里的动作落库 |
| 任务 | 长任务投递 `worker.go`（`ql_jobs`），不阻塞 HTTP，不用裸 goroutine |
| 文件 | 落盘必须走 `Store.write/read`，不绕过 Store 自己写文件 |
| 报告 | 正式报告是**快照**，后续资料变化不覆盖已签发报告 |

- **权限以工作台为准**：判定走 `q.can(code)`（登录时存下的权限码快照）；`ql_users.role` 只是兜底。新权限先加常量再映射 `rolePermissions`。
- **空间是会话属性**：`ql_sessions.space_kind/space_id` 决定会话在看哪个空间，`scopeWhere` 读它。切换走 `POST /api/switch-space`。不要新增第二套「团队」概念。
- **账号真相在工作台**：`ql_users` 只是影子行；客户授权唯一绑定是 `ql_grants.workbench_user_id`。

## 七、数据库变更

`schema.sql` 是 `CREATE TABLE IF NOT EXISTS`，只给新库建表，**不会给已有表补列**。给已有表加字段/索引：

1. 测试库执行并回归
2. 更新 `schema.sql` 供新环境
3. 在 `server/migrations/` 加 `NNN-xxx.sql`（必须幂等，用 `information_schema` 判存在）
4. 更新 `migrations/README.md`，发布时**用 root 手动按序执行**（应用账号没有 `ALTER` 权限）

漏执行会让带登录态的请求全部 1054。禁止直接改线上表而不回写迁移。

## 八、本地 Go 构建

本机 go-build 缓存目录可能不可写，把缓存指到工作区内：

```bash
GOCACHE=$PWD/.gocache GOTMPDIR=$PWD/.gotmp GOPATH=$PWD/.gopath \
  TMP=$PWD/.gotmp TEMP=$PWD/.gotmp go test ./...
```

Windows 下 `syscall.Umask` 不可用，权限收紧走 `umask_windows.go`，不要加回 `main.go`。

## 九、验证基线

```bash
cd server && go test ./... && go vet ./...
cd ../frontend && pnpm install --frozen-lockfile && pnpm check
```

`pnpm check` 依次跑 ESLint、目录边界、Vitest、生产构建。涉及路由/登录/底稿流程再跑 `pnpm smoke`（本机 Playwright + mock API：登录跳转、客户列表、底稿步骤 URL、SPA 跳转、390px、404）。真实接口仍需按 [10-本地开发与测试](docs/10-本地开发与测试.md) 做浏览器回归。

改完**至少**跑对应检查，全绿才算完成。无法验证（如无测试环境）必须**明确说明未验证**，不得声称已验证。

## 十、红线

1. ❌ 在清流里另建账号 / 支付 / 订单库，或绕开工作台改计费
2. ❌ 引入 Redis、消息队列、第二个常驻服务
3. ❌ 恢复单文件大组件；把业务逻辑塞回 `pages`
4. ❌ 页面直接 `fetch` / 直接 import `shared/api/client.js`
5. ❌ 前端缓存写 localStorage，或用它做资金/权限的最终判断
6. ❌ 字符串拼接 SQL；绕过 Store 直接写文件
7. ❌ 把真实密钥、服务器密码、客户资料写进代码或提交
8. ❌ 自动 `git commit` / `push` / 部署生产（除非业主明确说"上线/发布/部署"）
9. ❌ 提交 `node_modules`、无关的 `dist` 改动、`.env.local`、`.secrets/`
10. ❌ 未经确认改接口字段名、状态码、Cookie/CSRF 机制
11. ❌ 对同一用户无锁并发 `wbRefresh`（工作台 refresh 复用会吊销 family，表现为约 15 分钟后「请重新登录工作台账号」；见 [02 §5.1](docs/02-后端开发.md)）

## 十一、开工流程

1. **读**：本文 → `README.md` → `docs/00-项目总览.md`（涉及部署再读 `docs/05`）
2. **定位**：先查代码图/搜索定位符号与调用链，不凭猜改文件
3. **复述**：3–5 行输出「需求理解 + 环境 + 拟改文件清单 + 是否触碰红线」，**等业主确认**
4. **最小改动**：只改点名的地方，不顺手重构、不补无关测试、不改无关文档
5. **自检**：跑第九节；架构检查失败先修边界
6. **交付说明**：改了哪些文件、为什么、怎么验证、哪些没验证

## 十二、发布

默认**只改本地**，不自动提交、推送或部署。用户明确说"上线/发布/部署生产"时才按 [05-部署与运维](docs/05-部署与运维.md) 操作；发布前备份数据库、数据目录和旧二进制。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [00-项目总览](docs/00-项目总览.md) | 产品边界、角色、流程、代码地图、交接状态 |
| [01-前端开发](docs/01-前端开发.md) | 路由、Shell、登录、页面、公共 UI、样式 |
| [02-后端开发](docs/02-后端开发.md) | Go 进程、Store、加密、执行器、授权、工作台桥接（含 §5.1 令牌刷新自踢） |
| [03-数据模型](docs/03-数据模型.md) | `ql_*` 表、字段语义、迁移 |
| [04-接口清单](docs/04-接口清单.md) | 清流 API、Cookie/CSRF、上游工作台接口 |
| [05-部署与运维](docs/05-部署与运维.md) | 拓扑、发布、回滚、Nginx、备份、故障处理 |
| [09-AI全流程计划](docs/09-AI全流程计划.md) | AI 辅助分析的未开工设计与验收表 |
| [19-AI全链路运作图与字段清单](docs/19-AI全链路运作图与字段清单.md) | 主链路脑图、字段契约、分段喂模型、当前/优化对照、代码落点 |
| [计划-AI全流程融入与百页解析](docs/计划-AI全流程融入与百页解析.md) | AI 全流程产品设计与阶段门禁 |
| [测试表-AI全流程与百页解析](docs/测试表-AI全流程与百页解析.md) | 本机/夹具验收勾选表 |
| [10-本地开发与测试](docs/10-本地开发与测试.md) | 本地 MySQL、前端代理、测试、浏览器回归 |
| [11-工作台后台](docs/11-工作台后台.md) | 清流依赖的后台仓库、接口、套餐与支付；「请重新登录」≠ 挤号见 §7 |
| [12-查询缓存与操作记录](docs/12-查询缓存与操作记录.md) | 服务端分页、缓存 TTL、审计白名单与留存 |

Docker 部署文件、一次性迁移执行单、早期交付记录（`部署与交接.md`、`架构核查与迁移.md`、`验收记录.md`）与重复的 AI 规范副本已于 2026-11 清理：内容与本索引重复或已失效。需要历史时看 git log。
