# 计划 · 清流减负与 AI 赋能总册（验收摘要）

> **状态：主体已验收（2026-11-11 DoD + PDF 联调全绿）**  
> 本文是**压缩后的活摘要**，不再保留施工细节与 As-Is/To-Be 长图。  
> 现行实现口径见：[02-后端开发](02-后端开发.md) · [05-部署与运维](05-部署与运维.md) · [12-查询缓存与操作记录](12-查询缓存与操作记录.md) · 工作台 [data-retention.md](../../不加班智能团后端/docs/development/data-retention.md)

本地验收入口：[10-本地开发与测试](10-本地开发与测试.md) · [`samples/`](../samples/) · [`scripts/api-smoke-full-dod.ps1`](../scripts/api-smoke-full-dod.ps1)

---

## 1. 三原则（仍生效）

1. **前端优先，失败再后端**：CSV/XLSX/瘦 docx 本机拆表入库扣费；标准 PDF（有字）走加强解析文字层，同属成功主路径；扫描/加密/插图过重再进 worker / 视觉。成功后禁止服务器重解析同一份。
2. **AI 进主流程并扣费**：理解、核对预勾、人采纳/撤销；正式金额仍以人工确认为准。模型/视觉/计费档解析都扣积分（权威在工作台）。浏览器永不存 Key、禁止直连厂商。
3. **后端长任务不能假死**：按 `kind`/`task` 配超时与心跳，可取消；进度用轮询（已拍板不做推送）。

---

## 2. 阶段验收（全部 ✅）

| 阶段 | 内容 | 真机证据 |
| --- | --- | --- |
| S1 | 预检 / 门闩 / CSV·XLSX 本机拆行 / upload-parsed / busy 减负 / AI 必选文档 | `api-smoke-full-dod`：CSV/XLSX/docx 各扣 5 分 |
| S2 | `ai_*` 建议 + 采纳/撤销 | `ai-suggest` / `ai-adopt` 真机通过 |
| S3 | `jobPolicy(kind)` + 超时/取消；工作台 aidoc budget/cancel | page_ocr cancel 命中 `workbench_analysis_id` |
| S5 | 标准 docx 本机抽表 | `bank_statement_table.docx` 入库扣费 |
| S6 | page_ocr `text` 写回交易；报告备忘不改合计 | 扫描 PDF 写回 5 笔 |
| PDF | 有字 PDF text-layer；扫描 PDF → page_ocr | steps=7 ALL PASS |

**已拍板**：进度只轮询（不做 S4 推送）；中途积分不足 → 整单失败、保留已扫文字；视觉每批 **2** 页。

---

## 3. 现行落点（速查）

| 区域 | 路径 |
| --- | --- |
| 前端解析 / 门闩 | `upload-preflight`、`client-capability`、`client-parse`、`Upload*` |
| 前端减负 / 轮询 | `queries`、`useCaseData`、`useJobPoll`、`job-policy` |
| 前端 AI / 核对 | `features/ai-analysis/*`、`ReviewStep`、`TransactionTable` |
| 清流入库 / 扣费 | `upload-parsed`、`chargeParse`；worker/parser 仅兜底 |
| 清流 AI / 长任务 | `ai_analysis.go`、`workbench.go`、`jobPolicy(kind)` |
| 清流冷数据 | `cold_retention.go`（jobs/batches 30d、`ql_ai_analyses` 60d、pending/OS temp 7d；**不经** `poolFor`；**不删**正式底稿） |
| 工作台 aidoc | `internal/aidoc/*`；任务中心见工作台 `operations-runbook` |
| 工作台留存 / 月结 | `docs/development/data-retention.md`（与清流冷清理边界分离） |

---

## 4. 明确不做（仍生效）

- 第三方文档云转换；浏览器存 Key / 直连厂商  
- 上传自动烧视觉分；承诺识别所有银行；自动授信结论  
- 清流自建账号支付库；Redis；第二常驻服务；新 UI 框架  
- 前端结果不经服务端校验就落库；解析成功后再 worker 重算一遍  
- 进度推送通道（除非另开需求）

---

## 5. 残余 / 后续（非本总册施工范围）

| 项 | 说明 |
| --- | --- |
| 更多银行版式 | 农行/中行等按样例增量补；微信/支付宝/工行/官方表已有夹具 |
| 运维双层并发 | 清流 `QL_POOL_*` ≠ 工作台 `aidoc_concurrent_slots`，勿混为一谈 |
| 文档维护 | 行为变更写进 `02`/`05`/`12` 与工作台活文档；**勿再展开本总册施工章** |

勾选含义（历史）：⬜ 未做 · ◐ 进行中 · ✅ 已验收 —— 主体阶段均已 ✅。
