# 清流 · Go + React + MySQL 网页交付包

面向业务员的客户建档、流水初筛、人工复核与报告工作台。运行时为单个 Go 服务 + 团队已有 MySQL；React 已编译为静态文件。不使用 Python、Node 服务端、PostgreSQL、Redis、消息中间件或 AI API。

先看 `docs/部署与交接.md`、`docs/架构核查与迁移.md` 和 `docs/验收记录.md`。部署包包含源码、前端构建产物、Linux amd64/arm64 可执行文件、数据库初始化 SQL、Docker Compose、Nginx 示例和合成样例。不含真实客户资料、旧数据库、账号、密码、业务密钥。

## 程序员快速部署

前提：已有 Docker Compose、MySQL 8.0+（推荐团队现用 8.4）、HTTPS 反向代理；MySQL 内建立本应用专用库及专用用户。主机本地 MySQL 必须允许 Docker 网桥连接；容器内的 127.0.0.1 不是宿主机。

```bash
cp .env.example .env
# 编辑 .env；VAULT_KEY 使用 openssl rand -hex 32 生成
bash deploy/start.sh
bash deploy/init-admin.sh
curl -f http://127.0.0.1:8787/health
```

将现有 HTTPS 反向代理接到 `127.0.0.1:8787`，参考 `deploy/nginx.conf.example`。只有正确的 HTTPS 域名对应 `PUBLIC_ORIGIN` 后才让团队登录。不要公开 MySQL 或 8787 端口。

首次构建镜像需要下载 Debian 基础镜像和 PDF/OCR 系统工具。Go 和 React 已预编译，服务器不需要安装 Go、Node、Python；可在 CI 构建镜像后通过团队现有镜像仓库分发。无 Docker 时可用包内二进制配合 systemd，具体见部署说明。

## 功能与边界

四步流程：上传 → 确认持有人及纳入范围 → 逐笔核对 → 草稿、提交复核、正式内部初筛报告。支持管理员/业务员/复核员、客户授权、停用账号、改密撤销会话、操作日志、PDF 原页对照、标准 CSV/XLSX、已适配版式的 PDF、人工关联名单、重复隔离、分来源统计、完整自然月均/期间分摊月均、季度存款结息、冻结的 PDF/Excel/HTML 报告。

PDF/OCR 使用 Linux Poppler/MuPDF/Tesseract 命令行工具，不是额外语言服务。OCR 只给原文候选，不自动认定征信余额或贷款资格。新增银行版式须核对行数、方向、金额、控制总额；未完整识别的资料会阻止正式签发，可更正后补充标准表格并明确旧件不纳入。不要把“服务启动成功”理解成所有银行/征信版式已认证。

现有本地旧档案没有随本包迁移：原项目数据仍在原位置保留。需要历史档案时，先受控备份，再专项迁移并核对原件密钥、复核记录、报告快照和权限；不要直接把 SQLite 改后缀当 MySQL 导入。

## 修改与重建

开发机：Node 22.12+、Go 1.26+；本次产物使用的精确版本见验收记录。执行 `bash deploy/build.sh` 重新生成两个 Linux 架构的服务和 React 静态文件。依赖通过 `go.sum` 和 `package-lock.json` 锁定；修改源码后必须重建再部署。

Go 测试：`cd server && go test ./... && go vet ./...`。集成测试需指定独立名称包含 `_test` 的 MySQL 数据库，`MYSQL_DSN=... PDF_FONT=../fonts/NotoSansSC.ttf go test -v ./...`；未提供 MySQL 时集成用例会明确跳过。真实业务资料不在包内，私有 PDF 对照用例也会跳过。

本工具只供内部初筛参考，最终以核实资料和银行审核为准。
