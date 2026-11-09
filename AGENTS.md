# 清流项目工作区约定

本仓库是**清流 Qingliu** 专用开发工作区。进入后先读 `README.md`、`docs/00-项目总览.md`，部署前读 `docs/05-部署与服务器.md`。

## 环境（务必分清）

| 环境 | 清流前端 | 工作台后端（`WORKBENCH_BASE_URL`） | 服务器 | 数据库 |
|---|---|---|---|---|
| **生产** | `https://qingliu.bujiaban.top` | `https://worker.bujiaban.top` | `115.191.68.41` | 独立的一套 `qingliu` + `intelligent_team` |
| **测试** | 尚未部署（`qingliu.no996ai.cn` 无 DNS） | `https://worker.no996ai.cn` | `118.196.106.85` | 另一套独立库 |

- **`bujiaban.top` = 生产，`no996ai.cn` = 测试**。两套 MySQL 完全独立：套餐、价格、账号、余额、订单互不同步，改一边另一边不会变。
- `qingliu.bujiaban.top` 的 `WORKBENCH_BASE_URL` 必须是同环境的 `https://worker.bujiaban.top`；**禁止**指向 `worker.no996ai.cn`（测试）。指错就会读到测试库，测试后台新建/上架的套餐在清流永远查不到。
- 测试后台没有微信支付配置（`WECHAT_PAY_*` 全空，只注册了 `manual` 渠道）。`provider=wechat_native` 的套餐在测试环境下单会返回「支付未配置」；要在测试走完整下单流程，把测试库 SKU 的 `provider` 改成 `manual`，再由管理员在后台标记已支付。
- 切换 `WORKBENCH_BASE_URL` 之后必须重新登录：`ql_workbench_accounts` 里存的 access/refresh token 属于旧库，会全部失效；而且账号必须存在于目标工作台库（`t_user.email` 匹配、`service_code=qingliu`），否则登录会静默回落到本地密码，随后 `balance` / `orders` / `ledgers` 全部 503「请重新登录工作台账号」。
- 套餐在**对应环境**的控制台维护：生产 `https://worker.bujiaban.top/console/platform/packages`，测试 `https://worker.no996ai.cn/console/platform/packages`。

## 边界

- 本仓库只维护清流前端（React）和清流 Go 服务；工作台后台是另一个仓库，不在本仓库内改。
- 清流的登录、计费、支付订单都通过工作台后台服务完成；本仓库只做代理和界面，**不要**在清流里另建账号、支付或订单库。
- `frontend/dist` 是交付构建产物；修改前端源码后必须重新构建，不能只改 dist。
- `bin/` 是本机构建产物，默认不提交；发布时用 `deploy/build.sh` 重新生成。
- 生产服务器信息、密码、`VAULT_KEY`、SSH 私钥只在 `.secrets/` 或密码管理器；不要把真实值写进 README、提交记录、截图或日志。

## 前端架构

前端目录已按 `app → pages → features → shared` 分层，禁止恢复单文件大组件：

```text
frontend/src/
  main.jsx          只挂载 React
  app/              应用总装、routes.jsx、登录守卫、错误边界
  pages/            页面组合：login/clients/case/recharge/profile/admin/not-found
  features/         业务域：auth/clients/case/billing/ai-analysis/profile/admin
  shared/           api/router/layout/ui/hooks/lib/styles
```

强制规则：

- `shared` 不得依赖 `features` 或 `pages`。
- feature 内部用相对路径；跨 feature 只能引用对方 `index.js`。
- 页面不得直接 `fetch` 或引用 `shared/api/client.js`，必须调用 feature 的 `api.js`。
- 所有业务请求经 `shared/api/client.js`；CSRF、401、ApiError 只在这一层处理。
- 金额、日期、角色名、状态文案只在 `shared/lib` 或 feature `constants.js` 定义一次。
- 图标统一放 `shared/ui/icons.jsx`，不要用字符拼图标。
- 内部跳转必须用 `navigate()` / `<Link>`，禁止 `window.location.href` 造成整页刷新。
- 表单成功/失败统一走 `shared/ui/toast-api.js` 的 `toast()`；需要自定义提示时给 `Form` 传 `success=""`。
- 客户底稿四步走 `?step=` URL；新增功能加到对应 step/feature，不要堆回 `CasePage`。
- 颜色、字体、间距优先使用 `shared/styles/tokens.css`，保留现有深松绿/账本纸设计语言。
- 新增页面：加 `pages/<name>/`、必要时加 `features/<domain>/`、在 `app/routes.jsx` 注册，再按需改 `shared/layout/navigation.js`。
- 列表查询必须服务端分页；相同查询的复用和 TTL 只放在 `app/queries/index.js`，缓存原语只在 `shared/api/cache.js`。
- 写操作成功后先失效相关查询缓存再刷新；退出登录和 401 必须清空全部前端缓存。
- 缓存只放浏览器内存，不要写 localStorage/sessionStorage，也不要用于资金、权限、报告签发的最终判断。
- 操作记录统一走 `GET /api/admin/audit`，支持分页与筛选；不要再在 `/api/admin` 里附带全量事件。

## 开发约定

- 前端保持单页路由：`frontend/src/app/routes.jsx` 负责路由表，`shared/router` 负责 `pushState` 和全局链接拦截；不要新增导致整页刷新的内部链接。
- 表单消息统一走 Toast，不要恢复表单内绿色“已保存”或红色原始错误条。
- Go 侧保持单进程、标准库 `net/http`、MySQL、进程内单执行器；不要引入 Redis、消息中间件或第二个常驻服务。
- 客户原始资料/报告落盘前使用现有 `VAULT_KEY` 认证加密；不要绕过 Store 自己写文件。
- 数据库结构变更要版本化；目前 `schema.sql` 是 `CREATE TABLE IF NOT EXISTS` 启动建表，不能直接改线上表后不回写。

## 本地 Go 构建

- 本机 `C:\Users\<user>\AppData\Local\go-build` 可能不可写，构建/测试请把缓存指到工作区内：
  `GOCACHE=$PWD/.gocache GOTMPDIR=$PWD/.gotmp GOPATH=$PWD/.gopath TMP=$PWD/.gotmp TEMP=$PWD/.gotmp go test ./...`
- Windows 下 `syscall.Umask` 不可用，权限收紧走 `umask_windows.go`；不要把它加回 `main.go`。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [00-项目总览](docs/00-项目总览.md) | 产品边界、角色、流程、代码地图 |
| [01-前端开发](docs/01-前端开发.md) | 路由、Shell、登录、页面、Toast、品牌资源 |
| [02-后端开发](docs/02-后端开发.md) | Go 进程、Store、加密、执行器、报告、工作台桥接 |
| [03-数据模型](docs/03-数据模型.md) | `ql_*` 表、字段语义、迁移注意 |
| [04-接口清单](docs/04-接口清单.md) | 清流 API、Cookie/CSRF、上游工作台接口 |
| [05-部署与服务器](docs/05-部署与服务器.md) | systemd、Nginx、构建、发布、回滚 |
| [06-支付与套餐](docs/06-支付与套餐.md) | 套餐、SKU、订单、二维码恢复 |
| [07-运维手册](docs/07-运维手册.md) | 日志、备份、恢复、证书、故障处理 |
| [08-交接清单](docs/08-交接清单.md) | 已完成/待验证/账号/服务器 |
| [09-路线图](docs/09-路线图.md) | 未完成事项 |
| [10-本地开发与测试](docs/10-本地开发与测试.md) | 本地 MySQL、测试、浏览器回归 |
| [11-工作台后台](docs/11-工作台后台.md) | 清流依赖的后台仓库、接口、两套环境与发布 |
| [12-查询与缓存](docs/12-查询与缓存.md) | 服务端分页、操作记录接口、前端缓存 TTL 与失效策略 |

`docs/部署与交接.md`、`docs/架构核查与迁移.md`、`docs/验收记录.md` 是早期交付记录，冲突处以 README 和 docs/05 为准。

## 快速启动前端（5173 直连生产）

```bash
cd frontend
pnpm install       # 首次
pnpm dev           # → http://127.0.0.1:5173
```

- 端口固定 5173（`strictPort`），`/api` 与 `/health` 由 `vite.config.js` 反向代理到生产 `https://qingliu.bujiaban.top`；本地不需要 MySQL，也不需要起 Go 服务。
- 代理会改写 `Origin`/`Referer`，并剥掉响应 `Set-Cookie` 的 `Secure`，否则本地登录/保存会被 403、Cookie 也存不住。
- 换环境只改 `frontend/vite.config.js` 的 `target`，换完必须**重新登录**（旧 token 属于旧库）。
- 源码热更新即时生效；`frontend/dist` 是交付产物，发布前要重新 `pnpm build`。
- **本地登录预填**：`frontend/.env.local` 里的 `VITE_DEV_LOGIN_USERNAME` / `VITE_DEV_LOGIN_PASSWORD` 只在 `pnpm dev`（`import.meta.env.DEV`）时填进登录表单，生产构建里为空（已验证构建产物不含该口令）。该文件命中 `.gitignore` 的 `*.local`，不要提交。

## 验证基线

```bash
cd server && go test ./... && go vet ./...
cd ../frontend && pnpm install --frozen-lockfile && pnpm check
```

前端 `pnpm check` 依次执行：ESLint、目录边界检查、Vitest、生产构建。
涉及路由、登录或底稿流程时再执行：

```bash
cd frontend && pnpm smoke
```

`pnpm smoke` 使用本机 Playwright Chromium 和 mock API，验证登录跳转、客户列表、
底稿步骤 URL、SPA 跳转、390px 无横向溢出和 404。真实接口仍需按
`docs/10-本地开发与测试.md` 做浏览器回归；没有测试环境时明确说明未验证。

## 发布

默认**只改本地**，不自动提交、推送或部署。用户明确说“上线/发布/部署生产”时才按 `docs/05-部署与服务器.md` 操作；发布前备份数据库、数据目录和旧二进制。
