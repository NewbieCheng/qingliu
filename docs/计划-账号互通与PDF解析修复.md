# 清流 × 不加班：账号互通、注册登录、AI/PDF 解析与上传稳定性改造计划

> 状态：需求已确认并进入实现；代码与迁移已完成本地开发，**未提交、未部署生产**。
> 实现记录见第 11 节。  
> 涉及仓库：`F:\Dev\Desktop-Projects\qingliu-workspace`（清流）、`F:\Dev\Desktop-Projects\不加班智能团后端`（工作台后端）。  
> 目标：一个账号同时进入清流与不加班工作台；清流支持邀请码注册、个人/团队登录；修复 AI 解析失败与上传 `Failed to fetch`；把并发和排队控制在当前 2C/1G 服务器能承受的范围。


## 0. 已确认决策（2026-11-08）

以下内容已由需求方确认，后续实现以此为准：

1. **所有工作台账号自动开通清流权限**；账号互通按“一个账号 + 多产品访问关系”实现。
2. **先做团队登录，不做公开团队注册**；团队/公司仍由工作台后台创建，清流复用原有公司团队账号登录。
3. 清流登录页要同时支持**登录和注册**，交互参考工作台 Web 登录页，并支持邀请码注册。
4. 管理员账号积分采用**首次一次性赠送 99999**，不是余额永久锁定，也不改全平台注册默认值。
5. 默认邀请码 `WELCOME` 继续启用。
6. 允许使用本次提供的 PDF 做测试；真实敏感数据不提交 Git，只使用脱敏/合成样本入库。
7. **新增上传/解析百分比进度**：用户提交原件后，任务卡片必须显示当前阶段、百分比进度条和状态文案，降低等待焦虑。解析任务使用真实页数进度；AI 分块分析使用已知阶段进度，不伪造无法获知的模型进度。

### 0. 本次交付目标（Goal）

> 在不引入 Redis/消息队列/第二常驻服务的前提下，完成“一个账号互通两产品 + 清流邀请码注册 + 个人/团队登录 + 管理员首次 99999 积分 + AI/PDF 解析修复 + 上传解析百分比进度 + 上传传输层稳定性修复”，并通过后端单测、清流前端检查和真实 PDF 回归。

### 0. 进度条产品设计

- 上传接口成功后立即生成任务卡片，初始 `queued 0%`，文案“已进入队列，等待解析”。
- 本地解析按真实页码上报：`running`，进度从 5% 到 95%，文案“正在识别第 x / y 页，约 z%”。
- 完成 `done/partial 100%`，失败保留当时进度并显示失败原因。
- AI 分析按可确认阶段展示：上传原件 10%、创建任务 25%、排队 35%、模型分析 45%–90%、汇总 95%、完成 100%。
- 进度只用于体验展示，不能作为计费、权限、报告签发或数据完整性的判断依据。
- 任务恢复后进度按数据库状态重新计算；进程重启不把未完成任务显示成 100%。

---

## 0. 结论先说

### 0.1 账号现状：目前不是“账号互通”，而是“单产品账号”

工作台后端 `t_user` 目前只有**一个** `service_code`/`service_role` 字段：

- `internal/auth/service_login.go:69`：服务登录要求 `user.service_code` 必须等于当前服务（清流/工作台二选一）。
- `internal/auth/application.go:220` 附近的公开注册没有写 `ServiceCode`；`internal/auth/repository.go:1112` 会把空值归一成 `workbench`。
- 因此现在通过工作台注册的账号默认是工作台账号，不能直接登录清流；清流账号也不能天然登录工作台。
- 另外 `internal/auth/service_login.go:49` 的 `ServiceLogin` 没有把 `login_mode` 传下去，**企业/团队账号默认会按个人模式校验，团队登录会被拒绝**。

结论：要实现“一套账号、多个产品”，需要把“账号”和“产品访问权”拆开，新增“用户-产品成员关系”，不能继续用 `t_user.service_code` 承担所有产品。

### 0.2 AI 解析失败：PDF 本身大概率不是坏文件，当前链路存在三个结构性问题

已对你给的 PDF 做了检查：

- 文件：`微信支付交易明细证明(20251001-20260930)_20261027103123.pdf`
- 大小：1,143,653 字节（约 1.1MB）
- 页数：**129 页**
- 版本/生成器：PDF 1.3，Haru Free PDF Library 2.4.4
- 加密：否
- 文字层：**有**，中文/数字/表格文字可提取，不是纯扫描件
- 结论：不需要先做 OCR；文件大小、加密、扫描件都不是本次失败的解释。

当前工作台 AI 文档链路：

- `internal/aidoc/application.go:44`：AI 分析并发槽硬编码为 2。
- `internal/aidoc/extract.go:40`：`pdftotext -layout -f 1 -l <maxPages>`，只提取前 `AI_DOC_MAX_PAGES` 页。
- `internal/platform/config/config.go:267`：`AI_DOC_MAX_PAGES` 默认 **50**，而清流产品口径允许 500 页。
- `internal/aidoc/application.go:259`：提示词只保留前 **120,000 字符**，129 页文件会被静默截断。
- 任何提取错误最终都被 `internal/aidoc/handler.go` 的 `aidocPublicError` 统一成“文件解析失败”，详细原因放在 `details`，但清流 `wbMessage` 只读顶层 message，**真实原因被吞掉**。

所以截图里的“文件解析失败”只能说明“提取阶段失败”，不能说明是 PDF 坏了。最可能的原因按优先级是：

1. `pdftotext` 在服务器上超时、退出码非 0，或缺少二进制/字体工具；当前代码即使已经输出了有效文本，只要退出码非 0 也直接失败。
2. 129 页文件在第一页到第五十页的提取/进程调用上被 120 秒超时截断，或生产机并发时资源不足。
3. 即使提取成功，后 79 页也会被截掉；AI 结果不完整，这是必须修的另一个问题。
4. 服务器磁盘/临时目录、权限、`pdftoppm`/`tesseract` 缺失等环境问题；当前错误没有 trace 和明确原因码，无法从用户侧判断。

### 0.3 `Failed to fetch`：是浏览器没拿到 HTTP 响应，不是普通接口业务错误

前端 `frontend/src/shared/api/client.js:35` 直接 `await fetch()`，没有把 `TypeError: Failed to fetch` 转成中文，也没有请求 ID/耗时/传输层诊断。这个错误通常意味着：

- 请求被 Nginx/Go 断开，或服务进程重启/OOM；
- 上传过程中网络中断；
- Nginx/Go 超时后连接被关闭；
- 静态资源正常但后端端口不可达；
- 极少数情况是浏览器扩展、代理、证书或混合内容。

不能只靠截图断言根因。需要先拿到这次请求的 Nginx access/error 日志、systemd OOM/重启记录和服务端 trace。代码层面可以立即做四件事：

1. 上传请求快速返回 `202`，只做“落盘 + 建任务”，解析交给后台队列；
2. 增加客户端批次幂等键，网络失败后重试不会重复建任务/重复扣费；
3. 前端将网络错误、413、502、504 统一转成可读提示，并显示请求 ID；
4. 对齐 Nginx/Go 的 64MB 边界、120/130 秒超时和并发槽。

---

## 1. 本次改造范围

### 1.1 要做

- 一个账号可同时访问工作台和清流。
- 清流登录页支持“个人登录 / 团队登录”两个入口。
- 清流注册页复用工作台邀请码体系（同一张表、同一套规则、同一套后台管理）。
- 注册成功后，同一个邮箱/手机号/密码可登录清流，也可登录工作台。
- 管理员账号默认初始积分 99999（按“一次性初始赠送”实现，待确认）。
- 修复 AI 文档解析失败、PDF 页数截断和错误不可见。
- 修复上传 `Failed to fetch` 的传输层问题与错误提示。
- 任务队列、并发上限、重试、幂等、可观测性补齐到“最小可用”。

### 1.2 暂不做

- 不引入 Redis、消息队列、第二个常驻服务、微服务。
- 不重做工作台全部账号体系；保留现有 `t_user` 作为唯一身份表。
- 不开放“任意人创建团队”的公共自助建租户流程，除非你确认要；当前工作台的企业账号仍由运营/邀请创建。
- 不改变清流现有的客户授权、复核、报告业务规则。
- 不把 99999 设为全平台注册默认值；只用于管理员初始额度（待确认）。

---

## 2. 现状调研与证据

### 2.1 账号、登录、注册现状

| 项目 | 当前实现 | 问题 |
|---|---|---|
| 身份主表 | 工作台 `t_user` | 只有单值 `service_code` |
| 工作台注册 | `POST /api/v1/auth/register` | 只允许个人账号；必须邀请码 + 邮箱 OTP；手机号也必填 |
| 清流登录 | 清流 `/api/login` → 工作台 `POST /api/v1/service/auth/login` | 只传 email/password，没有登录模式；企业账号会失败 |
| 清流注册 | 无 | 前端只有登录页，没有注册页/验证码/邀请码接口 |
| 邀请码 | `t_registration_invite_code`，支持 code/grant_points/max_uses/expiry/status/note | 已可复用，但默认种子 `WELCOME` 是长期有效、无限次；生产需清理/轮换 |
| 管理员初始积分 | 管理端创建账号不自动发积分 | 需要单独的初始积分参数或幂等发放 |
| 全局注册赠送 | `t_asset_runtime_setting.registration_grant_points` 默认 100 | 不应为了管理员改成 99999 |

关键代码位置：

- `不加班智能团后端/internal/auth/application.go:173` `Register`
- `不加班智能团后端/internal/auth/application.go:187` 禁止公开企业注册
- `不加班智能团后端/internal/auth/service_login.go:49` `ServiceLogin`
- `不加班智能团后端/internal/auth/service_login.go:69` 单产品 scope 校验
- `不加班智能团后端/internal/auth/repository.go:1112` 空 service_code → workbench
- `不加班智能团后端/internal/auth/registration_invite.go` 邀请码消费逻辑
- `不加班智能团后端/internal/asset/application.go:426` 注册积分发放
- `不加班智能团后端/migrations/000054_service_accounts.up.sql` 当前单产品字段来源
- 清流 `server/workbench.go:43` 工作台登录桥接
- 清流 `frontend/src/features/auth/components/LoginForm.jsx` 只有账号/密码

### 2.2 PDF 解析现状

#### 清流本地解析（交易明细）

`server/parser.go`：

1. `pdfinfo` 读页数、加密状态。
2. `pdftotext -bbox-layout -enc UTF-8` 取带坐标文字。
3. 前两页识别来源：微信、支付宝、银行、征信。
4. 工行特定版式额外走 `mutool draw -F stext` 处理旋转文字。
5. 微信/支付宝按表头锚点和列边界切单元格；银行按带标签列解析；征信只生成原文候选事实。
6. 无文字且勾选 OCR 且来源是征信/其他时，`pdftoppm + tesseract`，OCR 只做候选，不自动下金融结论。

优点：交易行有坐标/表头校验，错误方向不会乱猜。  
风险：Poppler 命令缺失、版式变化、表头被拆词、扫描件手写/印章、OCR 精度都会导致 `partial`/`failed`；必须有回归样本。

#### 工作台 AI 文档解析

`不加班智能团后端/internal/aidoc/`：

1. `POST /api/v1/ai/documents` 接收 PDF/CSV，**同步**落盘并提取文字。
2. 提取优先 `pdftotext -layout`，文字太少才 `pdftoppm + tesseract`，再不行尝试视觉模型。
3. `POST /api/v1/ai/analyses` 建异步分析，进程内 2 个槽执行。
4. 分析前把文本截到 120k 字符，单次调用模型，结果写 `t_ai_analysis`。
5. 清流 `server/ai_analysis.go` 再上传原件、建分析、每 2 秒轮询，最长 6 分钟。

#### 对给定 PDF 的结论

- 129 页、有文字层、未加密，理论上 Poppler/Tesseract 都不应因“扫描件”失败。
- 当前 AI 只读前 50 页，就算成功也漏掉 79 页，必须按页分批。
- 错误详情没有传到清流，无法从截图判断是哪个命令失败；这是可观测性缺陷。
- 需要拿生产服务端日志确认 `pdftotext` 的退出码、耗时、stderr，以及是否发生超时/OOM。

### 2.3 上传与并发现状

| 资源/限制 | 当前值 | 位置 |
|---|---|---|
| 清流 HTTP 并发处理槽 | 4 | `server/main.go:794` |
| 清流后台执行器 | 1 个（全局串行） | `server/worker.go` |
| 清流 MySQL 连接池 | 8 | `server/store.go:48` |
| 清流 Go 读/写超时 | 120 秒 | `server/main.go:803` |
| Nginx 请求体 | 64MB | `deploy/nginx.conf.example:7` |
| Nginx 代理读写超时 | 130 秒 | `deploy/nginx.conf.example:13` |
| 工作台 AI 文档并发 | 2 个 | `internal/aidoc/application.go:44` |
| 工作台 AI 提取超时 | 120 秒 | `internal/aidoc/extract.go` |
| 清流 AI 上传 HTTP 客户端超时 | 15 秒 | `server/workbench.go:37` |
| 清流 AI 轮询总超时 | 6 分钟 | `server/ai_analysis.go:29` |

已发现的确定性问题：

1. **上传/解析没有彻底解耦**：清流 `/upload` 本身只落盘入队，速度很快；但 AI 分析是直接 `go a.runAIAnalysis`，没有进入 `ql_jobs`，没有并发上限，进程重启会丢失正在跑的分析。
2. **工作台文档上传同步提取**：清流上传原件的 HTTP 客户端只等 15 秒，而工作台提取可能跑 120 秒；两边超时不匹配，容易重试/误判。
3. **64MB 边界**：Nginx `client_max_body_size 64m` 是整个 multipart 请求体，10 个文件合计 64MB 时加上 boundary/header 会超限，实际可用总大小小于 64MB。
4. **错误被泛化**：任何提取失败都显示“文件解析失败”；任何网络 TypeError 都显示英文 `Failed to fetch`。
5. **重试可能重复**：上传没有客户端批次幂等键；网络断开后如果服务端已提交，用户重试会命中重复文件或重复任务。
6. **AI 分析可能被重复点击**：虽然按钮有 busy，但接口没有 per-user/per-customer 的“已有 queued/running 任务”去重。

---

## 3. 目标设计

### 3.1 身份模型：一个账号，多条产品访问关系（推荐）

保留 `t_user` 为唯一账号主表（登录名、密码、手机号、账号类型、租户、状态、粗粒度角色），新增：

```sql
CREATE TABLE t_user_service (
  user_id BIGINT UNSIGNED NOT NULL,
  service_code VARCHAR(32) NOT NULL,
  service_role VARCHAR(32) NOT NULL DEFAULT '',
  status TINYINT UNSIGNED NOT NULL DEFAULT 1, -- 1=启用, 2=停用
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, service_code),
  KEY idx_user_service_code (service_code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

迁移策略：

1. 把现有 `t_user(service_code, service_role)` 逐个回填到 `t_user_service`。
2. `t_user.service_code/service_role` 暂时保留为兼容字段，所有写路径双写，读路径逐步切到成员关系。
3. `ServiceLogin` 改为查 `t_user_service`；不再要求 `t_user.service_code` 等于产品。
4. 后台用户列表的 `service_code` 筛选改为查成员关系；保留旧字段返回，避免破坏现有控制台。
5. 新增管理端“产品访问”操作：启用/停用某用户对某产品的访问、设置产品角色。

角色映射建议：

- 工作台：继续使用 `account_type + tenant_id + t_user.role_code`，不变。
- 清流：使用 `t_user_service.service_role`（`admin` / `sales` / `reviewer`）。
- 现有平台管理员（`role_code=3`）回填清流 `admin`。
- 现有清流账号保留原 `service_role`。
- 其余需要开放的账号默认 `sales`，管理员后续可改。

> 需要你确认：是否真的是“所有工作台账号都能看清流”，还是只对指定账号开放。若按你的原话“账号互通”，我建议默认自动开通清流 `sales`，但保留管理员可按账号停用产品访问。

### 3.2 登录：个人 / 团队两个入口

清流登录页改为两个 Tab：

- 个人登录：`login_mode=personal`，只允许 `account_type=personal && tenant_id=0`。
- 团队登录：`login_mode=enterprise`，只允许 `account_type=enterprise && tenant_id>0`。

后端修复：

- `internal/auth/handler.go` 的 `serviceLoginRequest` 增加 `login_mode`（或 `mode`）。
- `internal/auth/service_login.go` 的 `ServiceLogin` 把该模式传给 `LoginCommand.Mode`。
- `ServiceLogin` 不再用单产品 `service_code` 判权，改为查 `t_user_service`。
- 清流 `wb.login()` 增加 `login_mode` 参数；`/api/login` 兼容旧请求（缺省 personal）。

团队登录不等于“团队注册”：团队账号仍由工作台企业流程创建/邀请加入，清流只负责登录和产品访问。若你要“注册时直接创建团队”，需要另定租户创建、管理员归属、套餐/席位规则，本次不建议混入。

### 3.3 注册：复用工作台邀请码

清流注册必须满足与工作台“一模一样”的规则：

- 同一个 `t_registration_invite_code` 表，不新建第二套邀请码。
- 同一个邀请码格式、状态、有效期、使用次数、赠送积分、后台管理页。
- 同一个邮箱 OTP 校验；手机号按现有规则必填但短信 OTP 暂不启用。
- 同一个密码强度、限流和人机验证。
- 注册成功后账号同时获得工作台和清流访问权（按 3.1 的策略）。

建议新增工作台服务端注册接口，由清流服务端用 `X-Service-Client`/`X-Service-Secret` 调用：

```http
POST /api/v1/service/auth/register
X-Service-Client: qingliu
X-Service-Secret: ******
Content-Type: application/json

{
  "email": "user@example.com",
  "phone": "13800138000",
  "display_name": "张三",
  "password": "********",
  "code": "123456",
  "invite_code": "BJB-XXXXXX",
  "login_mode": "personal"
}
```

返回与 `ServiceLoginResult` 同形状，至少包含：

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": "...",
  "user": {
    "user_id": 1,
    "email": "...",
    "display_name": "...",
    "account_type": 1,
    "tenant_id": 0,
    "service_role": "sales",
    "services": ["workbench", "qingliu"]
  }
}
```

注册内部原子步骤：

1. 校验邀请码、OTP、限流、唯一邮箱/手机号；
2. 创建 `t_user`（个人账号）；
3. 创建 `t_user_service` 两条成员关系（workbench、qingliu）；
4. 按邀请码的 `grant_points` 发放注册积分；若为 0，回退到全局默认 100；
5. 记录邀请码使用次数、审计、发放流水；
6. 签发 JWT/refresh；
7. 返回用户与 token。

清流侧新增：

- `GET /api/auth/captcha`：代理工作台验证码；
- `POST /api/auth/verification-codes`：代理发送邮箱 OTP；
- `POST /api/auth/register`：代理服务端注册，成功后创建本机 `ql_users`/`ql_workbench_accounts` 并建立会话；
- 前端新增 `/register` 页面和登录页“注册”入口。

### 3.4 管理员初始积分 99999

建议实现为“管理员账号创建时的一次性初始赠送”，不是全平台默认，也不是余额永久锁定 99999：

- 管理端创建用户请求增加 `initial_points` 字段；
- 当 `service_code=qingliu && service_role=admin` 时，创建表单默认 `99999`，可手动改；
- 发放使用固定幂等批次：`admin-seed:user:<user_id>`；
- 写 `t_point_ledger`，记录操作人、原因、邀请码（无）、trace；
- 已存在的指定管理员如需补到 99999，单独做一次性后台操作/脚本，先审计再执行，不做全表无差别补发。

不建议直接把 `registration_grant_points` 改成 99999，否则所有新注册用户都会得到 99999。  
需要确认：你说的“默认给管理员账号 99999”是**首次赠送 99999**，还是**管理员余额始终显示 99999**？我建议前者。

---

## 4. Bug 修复方案

### 4.1 Bug A：AI 分析“文件解析失败”

#### 4.1.1 先补诊断，不猜

新增/完善：

- 工作台 `t_ai_document` 记录：`sha256`、`extract_status`、`extract_error_code`、`extract_error_detail`、`pages_detected`、`pages_extracted`、`chars`、`duration_ms`。
- 错误码至少区分：
  - `MISSING_PDFTOTEXT`
  - `PDF_ENCRYPTED`
  - `PDF_TOO_MANY_PAGES`
  - `PDF_TEXT_EMPTY`
  - `PDF_TOOL_TIMEOUT`
  - `PDF_TOOL_EXIT`
  - `OCR_FAILED`
  - `VISION_FAILED`
- 响应返回 `code`、`message`、`trace_id`、`details.reason_code`；清流把 `reason_code` 和 `trace_id` 显示给用户，不再只显示“文件解析失败”。
- 保留服务端 stderr 摘要，但不要返回服务器路径、命令全文、密钥。

#### 4.1.2 提取逻辑重写

建议把 `internal/aidoc/extract.go` 改成：

1. 先用 `pdfinfo` 获取真实页数、加密状态；页数上限与产品统一为 **500**。
2. `pdftotext -layout` 分页/全量提取；把 stderr、退出码、耗时都记录下来。
3. **如果退出码非 0 但已有足够文本，不直接失败**：标记 `partial` 并继续分析，同时记录原因。
4. 按页判断文本量，而不是整份文件 `<20` 字符才 OCR：
   - 单页无文字 → 该页 OCR；
   - OCR 仍失败 → 该页标记 `needs_vision`；
   - 只为需要视觉的页调用视觉模型，避免整份 129 页都走视觉。
5. 文本按页保留页码标记，供后续分块和证据定位。
6. `Pages` 用 `pdfinfo` 的真实页数，不再用 `strings.Count("\f")` 猜测。

#### 4.1.3 长 PDF 分块分析

当前 129 页文件约 20 万字符，120k 截断会丢页。改为 map-reduce：

1. 按页切块（建议每块 15–25 页，或 ≤30k 字符，块之间重叠 1 页）。
2. 每块独立让 AI 输出结构化摘要：收入来源、异常点、待核实问题、页码证据。
3. 汇总阶段把各块结果合并，去重、保留页码引用。
4. 最终 JSON 增加 `coverage`：`pages_analyzed / pages_total`，让用户知道是否覆盖全文件。
5. 单文档总页数上限 500，总字符/模型预算设硬上限；超限明确提示，不静默截断。

对这份 129 页微信 PDF，预计切成约 6–9 块；分析耗时和积分会高于现在的单次调用，但不会再漏页。

#### 4.1.4 超时/并发修正

- `AI_DOC_MAX_PAGES` 从 50 改为 500（由部署环境显式配置）。
- 清流上传原件的 HTTP 客户端超时从 15 秒改为与工作台提取上限匹配（例如 150 秒），或更推荐：工作台把上传提取也改成异步，接口先返回 `202`。
- 工作台分析总超时按块数动态计算，避免固定 5 分钟不够。
- AI 分析并发默认仍为 2；增加 per-user 限制：同一用户同时最多 1 个 running + 3 个 queued，防止刷接口。

#### 4.1.5 用真实文件做回归

将这份 PDF 做脱敏后作为测试夹具（或至少生成同结构 129 页合成 PDF），验收：

- `pdfinfo` 真实页数 129；
- 文本提取页数 129；
- 分块覆盖第 1 页和第 129 页；
- 不出现未分类的“文件解析失败”；
- 结果 JSON 中有 `coverage.pages_total=129`；
- 失败时能看到原因码和 trace。

### 4.2 Bug B：上传 `Failed to fetch`

#### 4.2.1 先定位传输层

需要从生产环境取一次失败请求的：

- Nginx access log：状态码、请求体大小、请求耗时、upstream 地址；
- Nginx error log：`upstream prematurely closed connection`、`client intended to send too large body`、`upstream timed out` 等；
- qingliu systemd journal：是否重启、是否 OOM、是否有 panic；
- Go 服务端日志：请求 trace、处理耗时、数据库等待；
- 浏览器 DevTools Network：失败请求是 `(failed)`、`413`、`502`、`504` 还是 `net::ERR_*`。

没有这些信息时，不能把根因唯一归到“并发”或“文件大小”。但代码层面以下问题是确定的，都会放大故障。

#### 4.2.2 上传接口改为“快速接收 + 队列处理”

- `/api/clients/{cid}/upload` 只做：鉴权、校验、落盘、写 `ql_jobs(queued)`、返回 `202 {job_ids, request_id}`。
- 前端拿到 `202` 后立即提示“已进入队列”，通过现有 `busy/jobs` 轮询展示进度。
- 不在 HTTP 请求内做 PDF 解析（目前已经如此，继续保持并补测试）。
- 增加批次幂等键：前端生成 `client_batch_id`，服务端唯一约束；网络重试返回同一批任务，不重复扣费。
- 对同一客户已有 queued/running 任务时，返回明确的队列状态而不是让用户重复点击。

#### 4.2.3 对齐超时和请求体边界

- Nginx `client_max_body_size` 从 `64m` 调到 `70m`（或前端把整批上限降到 60MB）。
- Go `http.MaxBytesReader` 同步调整到 `70<<20`，避免 Nginx/Go 两套边界不一致。
- 清流 `ReadTimeout/WriteTimeout` 与 Nginx `proxy_*_timeout` 明确分层：
  - 上传接口应在 5–10 秒内返回；
  - 后台解析不受这两个 HTTP 超时限制；
  - 长任务只通过轮询接口返回状态。
- 为上传请求增加 `Idempotency-Key`/`client_batch_id` 和 `X-Request-ID`，服务端日志记录。

#### 4.2.4 前端错误处理

`frontend/src/shared/api/client.js`：

- 捕获 `fetch` 的 `TypeError`，转成“网络连接中断，文件可能未提交，请重试”；
- 对 `413`、`502`、`504`、空响应、HTML 错误页给出中文提示；
- 生成并回传 `X-Request-ID`；
- 上传请求增加 AbortController 超时（建议 120 秒）；
- 表单按钮在请求结束前保持禁用，避免双击。

#### 4.2.5 排除服务端 OOM/重启

- 检查 systemd `MemoryMax=1G`、`GOMEMLIMIT=512MiB` 是否被 OCR/PDF 渲染打爆；
- 解析仍保持单执行器，不按 8 核开 8 路；
- 为 PDF 渲染/OCR 增加临时目录大小上限和页数上限；
- 失败后保留任务和原件，允许重试，不能丢任务。

---

## 5. 并发与容量设计（最小可用，不过度设计）

### 5.1 建议初始值

| 项目 | 建议值 | 理由 |
|---|---|---|
| 清流 API 并发槽 | 4（保持） | 2 vCPU/1G，小团队够用，避免大量慢请求 |
| 清流解析 worker | 1（保持） | PDF/OCR 内存大头；先保证稳定 |
| 清流报告任务 | 与解析共用 1 个 worker | 不引入第二套常驻进程 |
| 清流 AI 任务 | 进入 `ql_jobs`，1 个本地 worker 提交/轮询 | 替代裸 goroutine，可恢复、可限流 |
| 工作台 AI 分析 | 2（保持） | 模型调用是 I/O 等待，2 路足够小团队 |
| 工作台文档提取 | 串行或最多 2 | `pdftotext/OCR` 是 CPU/内存操作，不能按核数全开 |
| 单用户 AI 排队 | 1 running + 3 queued | 防止一个用户刷爆队列 |
| 单客户并发任务 | 1 个解析/报告任务 | 现有客户锁规则不变 |
| 单文件 | ≤30MB、≤500 页 | 与产品口径一致 |
| 单批次 | ≤10 份、请求体 ≤70MB | 给 multipart 留余量 |
| 数据库连接 | 8（保持） | 同机还有工作台/MySQL，避免占满 |

### 5.2 能支持多少人

- **在线浏览/核对**：瓶颈是 4 个 HTTP 槽和 MySQL 查询，小团队 10–20 人日常使用通常没问题；具体要看列表查询和原页渲染频率。
- **同时上传**：接口快速入队，不会因为解析慢而阻塞；用户看到“排队中”。
- **同时解析**：1 路串行。若 10 人同时上传 100 页扫描件，会排队；这是当前 2C/1G 下为了保证不 OOM 的取舍。
- **AI 分析**：工作台 2 路并发；长文档分块后单份会占用更久，但不会丢页。
- 不建议为了“看起来支持更多并发”直接把解析 worker 调到 4/8；应先在真实服务器上压测内存峰值，再决定是否从 1 调到 2。

### 5.3 队列行为

- 上传/报告/AI 都写 `ql_jobs`，状态：`queued → running → done/failed/partial`。
- 前端展示队列位置/当前阶段，不显示无限转圈。
- 任务失败可重试；原件保留；同一 `client_batch_id` 重试幂等。
- 进程重启后 `running` 回退为 `queued`（现有恢复逻辑保留）。

---

## 6. 接口与数据库变更清单

### 6.1 工作台后端

新增：

- `POST /api/v1/service/auth/register`
- `GET /api/v1/admin/users/:user_id/services`
- `PUT /api/v1/admin/users/:user_id/services`
- `GET /api/v1/auth/captcha`（已有）
- `POST /api/v1/auth/verification-codes`（已有，清流服务端代理调用）

修改：

- `POST /api/v1/service/auth/login`：增加 `login_mode`，查 `t_user_service`。
- `POST /api/v1/admin/users`（或 platform-users）：增加 `initial_points`，默认按管理员 99999。
- `POST /api/v1/admin/registration-invites` 等邀请码接口：保持不变，清流复用。
- `GET /api/v1/admin/users`：`service_code` 筛选改为成员关系。
- AI 文档/分析接口：错误结构、页数、分块、诊断字段。
- 用户 DTO：增加 `services` 数组，保留旧字段。

迁移 `000058_user_services_and_ai_diagnostics`：

- 新建 `t_user_service` 并回填。
- `t_ai_document` 增加 `sha256`、`extract_status`、`extract_error_code`、`extract_error_detail`、`duration_ms`。
- 视需要给 `t_ai_document` 加 `UNIQUE(user_id, sha256)` 或普通索引（先普通索引，避免历史重复阻断迁移）。
- 更新 `httpserver.LatestMigrationVersion=58` 和迁移测试。

### 6.2 清流后端

新增：

- `GET /api/auth/captcha`
- `POST /api/auth/verification-codes`
- `POST /api/auth/register`
- `POST /api/login` 增加 `login_mode`（兼容旧参数）
- `GET /api/me` 返回 `services`/当前产品角色（可选）

修改：

- `workbench.go` 的 `login`/`register` 代理。
- `ai_analysis.go`：从裸 goroutine 改为 `ql_jobs` 任务；状态包含 `queued/running/done/failed` 和阶段。
- `main.go` 上传接口：`202` + `client_batch_id` 幂等；请求体边界调整。
- `worker.go`：增加 `ai_analysis` 分支，保持单 worker。
- 错误响应：透传工作台 `reason_code`/`trace_id`。

### 6.3 清流前端

- 新增 `/register` 页面。
- 登录页增加“个人登录 / 团队登录”Tab。
- 注册表单：邮箱、手机号、显示名、密码、邀请码、邮箱验证码、图形验证码。
- 登录/注册接口调用新 API。
- 上传错误 Toast：中文网络错误 + 请求 ID。
- 队列状态展示：排队位置/当前阶段/预计等待（有数据才显示）。
- `api/client.js` 统一处理网络 TypeError、413/502/504。

---

## 7. 实施顺序

### 阶段 0：复现与取日志（0.5 天）

- 在生产复现这份 129 页 PDF 的 AI 解析；
- 取 Nginx/Go/systemd 日志，确认是超时、工具缺失、OOM 还是文件本身；
- 记录一次 `Failed to fetch` 的完整 Network/日志证据；
- 输出一份“实际根因”补充记录，再进入编码。

### 阶段 1：账号统一与登录（2–3 天）

- `t_user_service` 迁移/回填；
- `ServiceLogin` 改成员关系并支持 `login_mode`；
- 服务端注册接口 + 邀请码/OTP；
- 管理端产品访问管理；
- 管理员初始积分 99999；
- 后端单测/契约测试。

### 阶段 2：清流登录/注册前端（1–2 天）

- 登录 Tab、注册页、验证码、邀请码；
- 清流本地会话映射；
- 注册后跳转与 `me` 信息；
- 浏览器冒烟。

### 阶段 3：PDF/AI 解析修复（2–3 天）

- 提取诊断、页数/工具错误码；
- 全量 500 页、按页 OCR/视觉；
- 长文档分块 map-reduce；
- AI 分析入 `ql_jobs`；
- 真实 PDF 回归测试。

### 阶段 4：上传可靠性与并发（1–2 天）

- `202` 快速入队、批次幂等；
- 前端网络错误处理；
- Nginx/Go 边界和超时对齐；
- 并发/限流/队列状态；
- 压测与验收。

### 阶段 5：发布与回滚（0.5 天）

- 备份数据库/数据目录；
- 迁移 + 发布；
- 验证健康检查、登录互通、注册、PDF、上传；
- 失败按备份回滚。

预计总工作量：**7–11 个开发日**（不含你确认需求和真实生产压测）。如果先只修两个 bug、不做账号统一，可缩短到 3–5 天；但账号互通是这次的核心，不建议拆掉。

---

## 8. 验收标准

### 账号

- [ ] 现有工作台账号可直接登录清流，角色正确。
- [ ] 清流新注册账号可登录清流，也可用同一邮箱/密码登录工作台。
- [ ] 个人登录、团队登录分别成功；团队账号不再被误判为个人。
- [ ] 邀请码错误/过期/次数用尽/停用时，注册失败且提示明确。
- [ ] 同一邀请码只能按 `max_uses` 消费；并发注册不会超发。
- [ ] 注册赠送积分与邀请码/全局默认一致。
- [ ] 管理员首次创建得到 99999，流水可审计；普通注册仍是 100 或邀请码配置值。
- [ ] 停用产品访问后，该账号不能登录对应产品，但另一产品不受影响。

### PDF/AI

- [ ] 129 页样例能提取到 129 页，不再只读 50 页。
- [ ] 分块覆盖第 1 页和第 129 页，结果带 `coverage`。
- [ ] 有文字层 PDF 不误走 OCR；扫描件只对空白页 OCR/视觉。
- [ ] 工具缺失/超时/加密/空文本分别返回明确原因码和 trace。
- [ ] AI 任务可在进程重启后恢复，不因刷新页面丢失。
- [ ] 同一文档重复点击不会创建多个并发分析。

### 上传

- [ ] 1.1MB PDF 上传在 10 秒内返回 `202` 并入队。
- [ ] 64MB 边界批次不会因 multipart 开销被 Nginx 413。
- [ ] 断网/超时后前端显示中文提示，不显示 `Failed to fetch`。
- [ ] 网络恢复后重试同一批次不重复建任务、不重复扣费。
- [ ] 10 个并发上传 + 1 个长 PDF 解析时，服务不崩溃、不 OOM、不丢任务。
- [ ] Nginx/Go/systemd 日志能通过 request ID 串起一次请求。

---

## 9. 风险与需要你确认的问题

### 必须确认

1. **“所有工作台账号都能登录清流”是否包含企业/团队账号？**  
   我建议包含，但默认清流角色为 `sales`；平台管理员映射 `admin`；其余按需调整。若清流客户数据敏感，也可以改成“管理员按账号开通”，但那就不是你说的完全互通。

2. **“团队登录”是否还需要“团队注册”？**  
   我建议本次只做“团队登录 + 个人注册”；团队注册涉及创建租户、owner、席位、套餐，属于另一条产品流程。若你要求注册页直接创建团队，需要再确认租户归属和管理员是谁。

3. **管理员 99999 是首次赠送还是余额锁定？**  
   我建议首次赠送 99999，流水可审计；不把全局默认注册积分改成 99999。

4. **生产环境默认邀请码 `WELCOME` 是否还在启用？**  
   代码种子里它是无限次、长期有效。上线前应禁用/轮换，避免公开注册被滥用。需要确认当前生产实际状态。

5. **是否允许我把这次失败的 PDF 脱敏后作为仓库测试样本？**  
   涉及真实姓名/账号/交易，建议只保留结构做合成样本，或放在不进 Git 的私有测试目录。

### 已知风险

- 清流现有数据是独立库；账号统一只统一身份，不会自动合并两套历史客户/报告数据。
- 工作台账号和企业租户的 RBAC 与清流产品角色不是同一套词汇，迁移时必须做明确映射，不能简单照搬 `role_code`。
- 500 页 + 分块 AI 会提高模型调用次数和积分消耗；需要设置单文档预算上限和用户提示。
- 当前服务器 2C/1G 的容量结论来自历史验收，不是本次压力测试结论；上线前必须用真实文件做一次峰值观察。
- 不引入 Redis/MQ 的前提下，队列是 MySQL + 进程内 worker；如果未来多实例部署，需要把 worker 的数据库锁/任务领取逻辑再升级。

---

## 10. 建议的下一步

1. 你先确认第 9 节的 5 个问题（尤其是团队注册、99999 语义、是否全量互通）。
2. 我根据确认结果先把**接口契约 + 迁移脚本草案 + 前端页面结构**落成第二版计划或直接开始阶段 0/1。
3. 生产日志拿到后，把“AI 文件解析失败”的真实原因补进本文档，再进入编码。

> 本文档不包含任何真实密码、密钥、客户账号或生产主机信息。

---

## 11. 实现记录（本次提交内容）

### 11.1 工作台后端（`不加班智能团后端`）

| 文件 | 变更 |
| --- | --- |
| `migrations/000058_user_service_access.up.sql` | 新增 `t_user_service` 产品访问表，并把所有已有账号回填为 workbench + qingliu（平台管理员→qingliu admin，其余→sales） |
| `internal/auth/domain.go`、`ports.go`、`repository.go` | `UserService` 模型与仓储：`EnsureUserService`（幂等 upsert）、`FindUserService`、`ListUserServices`、`SetUserServiceStatus` |
| `internal/auth/application.go` | 注册/管理端建号后自动开通两个产品；`serviceRoleForUser` 以成员关系为授权来源 |
| `internal/auth/service_login.go` | 服务登录改查 `t_user_service`；新增 `ServiceRegister` |
| `internal/auth/handler.go`、`routes.go` | `POST /api/v1/service/auth/register`；服务登录支持 `login_mode`（个人/团队） |
| `internal/aidoc/extract.go` | 全量提取（不再只取前 50 页）、`pdfinfo` 真实页数、逐页 OCR、稳定原因码（缺工具/加密/超页/超时/退出码/空文本） |
| `internal/aidoc/chunk.go` | 长文档按页分块 + map-reduce 汇总，结果带 `coverage.pages_total/pages_analyzed/chunks` |
| `internal/aidoc/application.go` | 500 页上限、分块分析、块进度写库、失败也落诊断记录、分析超时 20 分钟 |
| `internal/aidoc/handler.go` | 响应带 `extract_error_code`、`extract_error_detail`、`duration_ms`、`progress`；错误消息按原因码给可操作提示 |
| `internal/platform/config/config.go` | `AI_DOC_MAX_PAGES` 默认 50 → 500 |
| `internal/platform/httpserver/health.go` | `LatestMigrationVersion` 57 → 59 |
| `migrations/000059_ai_extract_diagnostics.up.sql` | `t_ai_document` 增加 sha256/提取状态/错误码/耗时；`t_ai_analysis` 增加 progress |
| `api/openapi/openapi.yaml` + `embed/openapi.yaml` | 登记注册接口与服务登录的 `login_mode` |

### 11.2 清流后端（`qingliu-workspace/server`）

| 文件 | 变更 |
| --- | --- |
| `main.go` | `/api/login` 支持 `login_mode`（1 个人 / 2 团队）；新增 `/api/register`、`/api/auth/captcha`、`/api/auth/verification-codes` 代理；上传接口返回 `jobs/batch` 并支持批次幂等 |
| `workbench.go` | `login(mode)`、`register`、`verification-codes`、`captcha` 代理 |
| `ai_analysis.go` | AI 分析改为 `ql_jobs` 队列任务（可恢复、不重复、有进度）；`wbFailure` 保留 reason_code 与 trace |
| `worker.go`、`store.go` | 任务 `progress/stage` 写入与真实页进度（5%→95%）、完成 100% |
| `schema.sql`、`migrations/002-job-progress.sql` | `ql_jobs` 加 progress/stage/upload_batch，新增 `ql_upload_batches`；`ql_ai_analyses` 加 progress/stage |
| `umask_unix.go` / `umask_windows.go` | 修复 Windows 下 `syscall.Umask` 无法构建（原本就存在的跨平台问题） |
| `progress_test.go`、`wbfailure_test.go` | 进度换算、阶段单调、登录模式、错误码透传测试 |

### 11.3 清流前端

| 文件 | 变更 |
| --- | --- |
| `pages/login/LoginPage.jsx` | 登录/注册切换；保留深松绿 × 账本纸设计 |
| `features/auth/components/LoginForm.jsx` | 个人登录 / 团队登录 Tab |
| `features/auth/components/RegisterForm.jsx` | 邀请码 + 邮箱验证码 + 图形验证码注册 |
| `features/auth/AuthProvider.jsx` | 新增 `register`，注册后直接接管会话 |
| `features/case/components/TaskList.jsx` | 任务卡显示阶段、进度条、百分比；失败保留进度与原因 |
| `shared/api/client.js` | `Failed to fetch` 转中文、413/502/504/超时提示、`X-Request-ID`、上传超时控制 |
| `shared/ui/UploadDropzone.jsx` | 批次幂等键、整批上限 64MB→60MB（给 multipart 留余量） |
| `shared/styles/auth.css` | 登录 Tab、注册表单、进度条样式 |

### 11.4 验证结果

| 项目 | 结果 |
| --- | --- |
| 工作台 `go build ./...` | 通过 |
| 工作台 `go vet ./...` | 通过 |
| 工作台 `go test`（除 `docs` 契约包） | 通过 |
| 工作台 `docs` 契约包 | **失败，但与本次无关**：`docs/后端目录清理与文档整合计划书.md:86` 的 qwen-image 单价与代码不一致，属既有文档债 |
| 工作台 OpenAPI 契约测试 | 通过（已同步 embed 副本） |
| 清流 `go build ./...` / `go vet ./...` | 通过 |
| 清流新增单测 | 通过 |
| 清流全量 `go test ./...` | 有 1 个既有失败：`TestParseAuditQueryBoundsAndFilters` 期望 5 个参数，实际 SQL 有 6 个（`e.action LIKE ?`），与本次改动无关 |
| 清流前端 `npm run lint` / `check:arch` / `test` / `build` | 全部通过（23 个单测） |

### 11.5 上线前必须执行

1. 备份两套数据库与清流数据目录。
2. 工作台执行 `migrate up`（58、59），确认 `schema_migrations=59`、`/health/ready` 200。
3. 清流执行 `server/migrations/002-job-progress.sql`（`ql_jobs`、`ql_ai_analyses`、`ql_upload_batches`），重复执行前先确认列不存在。
4. 清流 `.env` 增加 `AI_DOC_MAX_PAGES=500`（工作台侧）并在 systemd 环境中确认。
5. Nginx 保持 `client_max_body_size 64m`；前端已按 60MB 收口。
6. 部署后回归：工作台账号直接登录清流、团队登录、邀请码注册、129 页微信 PDF 走通 AI 分析、上传进度条从 0% 走到 100%。

### 11.6 未包含在本次改动中

- 扩展的 PDF 服务端 **异步提取**（目前上传仍在请求内完成提取）。当前已通过全量提取 + 逐页 OCR + 超时原因码缓解；若要彻底消除长请求，需要给 `POST /ai/documents` 增加 `202 + 轮询` 契约，属下一阶段。
- 工作台后台控制台的“产品访问”管理页（接口与数据模型已就绪，控制台菜单入口未加）。
- 管理员首次 99999 积分：数据模型与赠送接口已具备（邀请码 `grant_points`、`t_point_ledger` 幂等批次）；后台表单的默认值与一键补发脚本未落，需确认是走邀请码授予还是单独后台操作。

---

## 12. 追加：AI 能力新增「文档视觉识别（page-ocr）」

### 12.1 方案结论

可行，且不需要改造模型网关的执行面。做法是**在「AI 能力」里新增一条独立能力链**，
OCR 请求显式指向该链，复用网关既有的路由、计费、审计与通道健康：

- 新增能力 `page-ocr`（中文名「文档视觉识别」），归入「AI 能力 / 模型路由」分组，
  与声音复刻、语音合成、图像生成、文本对话、口型、视频并列；
- 定价行 `task_type = page-ocr`，运营通过 `route_chain_order:page-ocr` 决定
  「哪家视觉模型负责批量 OCR」，与 chat 链完全解耦（改 OCR 不影响所有对话）；
- 不改 `POST /v1/chat/completions` 的任何语义：OCR 只是**调用方**多了一个
  「按页拼消息」的循环。

### 12.2 「超过 1.2 万字」的真实原因与解法

用户提到的 12 万字上限不是模型上下文限制，而是旧代码里的
`truncate(text, 120000)` ——一个硬编码的字符截断。上下文更大的模型也救不了它，
因为被截掉的文本根本没有发出去。

现在有两条互补路径，都不再按总字数截断：

| 路径 | 适用 | 上下文压力 |
| --- | --- | --- |
| 文本分块（chunk map-reduce） | 有文字层的 PDF/CSV | 每块 ≤24k 字符，块间重叠 400 字，总页数不丢 |
| 文档视觉识别（page-ocr） | 扫描件、图片型流水、印章遮挡 | **每次只发一页图**，上下文与总页数无关 |

因此 100+ 页（含 500 页上限内）都能跑，区别只是耗时与积分：OCR 每页一次模型调用。
单份页数上限由 `AI_DOC_MAX_OCR_PAGES`（默认 500）控制，超出返回
`PDF_TOO_MANY_PAGES` 而不是静默截断。

### 12.3 实现清单

**工作台后端**

| 文件 | 变更 |
| --- | --- |
| `internal/modelkey/tts_chain_admin.go` | 新增 `RouteChainPageOCR = "page-ocr"`、`routeChainTaskTypes` 与展示顺序 |
| `internal/modelkey/domain.go` | 新增 `TaskPageOCR` 并纳入 `validTaskType` 白名单（否则定价行建不出来） |
| `migrations/000060_page_ocr_capability.up.sql` | 登记能力行（显示名、图像模态、排序 35） |
| `internal/generation/upload_policy.go` | 显式登记 `page-ocr` 不上传客户端素材（页图由服务端渲染内联） |
| `internal/aidoc/ocr.go` | 逐页 `pdftoppm` 渲染 + 分段并发识别（`OCRVisionBatch=2`），峰值内存约 2 张图 |
| `internal/aidoc/application.go` | `task=page_ocr` 走 OCR 分支，识别结果写回文档文本供后续分析复用；页进度写库 |
| `cmd/server/main.go` | 组合根注入 `aidocOCRExtractor`，模型固定 `page-ocr`，计费走同一条链路 |
| `api/openapi/openapi.yaml` + embed | `task` 枚举增加 `page_ocr`，说明单页上下文与 500 页上限 |
| `web/admin` | `ROUTE_CHAINS` 增加 `page-ocr`；五个语系补 `routeChainName.page-ocr`；自检期望值改为从后端清单推导 |

**清流**

| 文件 | 变更 |
| --- | --- |
| `server/main.go` | `/ai-analysis` 接受 `task=page_ocr` |
| `server/ai_analysis.go` | 透传任务类型；逐页 OCR 时把工作台真实百分比映射到 40%-95% |
| `frontend/src/features/ai-analysis/*` | 新增「文档视觉识别（OCR）」按钮与进度条 |

### 12.4 验证

- 工作台 `go build` / `go vet` / 除 `docs` 包外全部测试通过（含 modelkey 路由优先级、
  能力种子一致性、上传口径注册）；
- 清流 `go build` / `go vet` / 新增进度与错误码测试通过；
- 清流前端 `npm run lint` / `check:arch` / `test` / `build` 通过；
- 管理台 `npm run ui:check` 五语系全部通过，`npm run build` 成功。

### 12.5 上线注意

1. 工作台执行 `migrate up` 到 60，`t_ai_capability` 会出现「文档视觉识别」。
2. 在「AI 能力 → 模型路由」里给 `page-ocr` 排候选：候选来自
   `t_model_pricing` 中 `task_type=page-ocr` 且**支持图片输入**的定价行。
   没有候选时 OCR 会返回明确错误，不会退回文本层。
3. 环境变量：`AI_DOC_MAX_OCR_PAGES`（默认 500）控制单份 OCR 页数。
4. 成本提示：OCR 按页计费，100 页≈100 次视觉调用；建议在套餐里单独告知用户。
