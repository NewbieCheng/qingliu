# 计划：AI 解析面板重做 + 流式输出 + 不支持资料分流 + 原件预览下线

> 状态：待批准执行
> 日期：2026-11-21
> 目标环境：本地全链路验证 → 生产 `115.191.68.41` 部署
> 关联文档：`docs/计划-解析链路修复与AI参与+本地自动化测试准备.md`

---

## 一、已核实的现状与根因（不是猜的，都有证据）

### B1. AI「提取要点」线上必失败 —— 超时值写小了（**最高优先级**）

生产日志实证：

```
wb.do: Client.Do failed method=POST url=https://worker.bujiaban.top/v1/chat/completions
  err=Post "...": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
general-parse: wbChatText failed: Workbench temporarily unavailable. Please retry later.
```

- 位置：`server/workbench.go:38` —— `Client: &http.Client{Timeout: 15 * time.Second}`
- 连通性正常（生产机 `curl -m 20` 到 worker 只要 0.02s 建连），**纯粹是模型推理耗时 > 15s**。
- 对照：OCR 路径早已做了长超时特例 `workbench.go:648-655`（120s），**但 chat 没做**。
- 结论：用户点"AI 提取要点" → 15 秒被斩 → 红条 "Workbench temporarily unavailable"。本地之所以"通过"，是因为本地 worker 响应 < 15s，属侥幸。

### B2. 「原件页加载失败」（图1，第 1/30 页）

- 接口：`GET /api/clients/{cid}/original/{did}/{page}`（`main.go:953`）
- 前端：`OriginalEvidenceDialog.jsx` + `page-preview-cache.js`
- 失败面：`totalPages` 取自 `payload.pages`；截图里文档 `mx20261117165209732435473(1).pdf` 报 30 页而实际与 `pages` 不符，且服务端 `pdftoppm` 渲染在该文档上失败 → 404/500 → 前端显示"原件页加载失败"。
- 用户决策：**这个功能直接删掉**，不再修。

### B3. mx 流水 675/1078 行全部「解析失败 · Q01」（图2）

`ql_transactions` 实证，675 行全部 `quality=invalid, direction=unknown`：

```json
{"raw":"1 | 2025-09-21 | CNY | 4.69 | 36,027.40付息/DP117XXXXXX0D999/利息支出",
 "date":"2025-09-21","amount":"4.69","income":null,"expense":0,
 "direction":"unknown","quality":"invalid","error":"方向或金额未确认"}
```

- 真实原因：**该银行文本层是"单列金额 + 余额粘连"格式**（`4.69` 是交易额、`36,027.40` 是余额，中间无分隔），现有行解析器（`domain.go:319 classify` → Q01）认不出金额与方向。
- 后果：1078 笔全部进"解析失败/疑似重复隔离"，**后续核对流程整条断掉**——这就是用户说的"后面流程根本不匹配"。
- 这不是 UI 问题，是**文本层行解析器的格式适配缺口**。

### B4. 其余已确认项

| 项 | 现状 |
| --- | --- |
| 流式输出 | 无。`runGeneralParse` 一次性返回，用户干等，焦虑 |
| 不支持资料的分流 | 无。任何文件都硬塞进流水/表单流程，识别完没有"这份不支持后续流程"的出口 |
| AI 结果复制/导出 | 无 |
| 生产 token 轮换 | `wbRefresh` 单飞机制正常，但超时会把 refresh gate 一起拖死（B1 的连带伤害） |

---

## 二、目标与验收标准

### 总目标

> 让"用户点 AI 提取 → 能看到字流出来 → 结果能复制导出"成为稳定链路；让"上传了不支持后续流程的资料"有一个明确出口；把不可靠的原件预览下线，用可靠的引用替代。

### 验收标准（逐条可测）

| # | 验收点 | 通过条件 |
| --- | --- | --- |
| A1 | AI 提取不再 15s 超时 | 生产上对一个 4000 字申报表点"AI 提取要点"，**3/3 次成功**返回结构化结果（P95 < 90s，最长不截断） |
| A2 | 流式输出可见 | 点击后 **≤2s** 出现首个字；界面持续增长；结束后渲染成表格 |
| A3 | AI 失败可诊断 | 任何失败给**人话 + 原因码**（超时/额度/模型不可用/输入为空），不再只有 "temporarily unavailable" |
| A4 | 结果可复制/导出 | 一键复制（Markdown 表格）、一键导出 `.md`/`.csv`；复制内容不含 HTML 标签 |
| A5 | 不支持资料有出口 | 上传非流水/非表单资料 → 识别完成 → 明确告知"该资料暂不支持后续核对流程，已为你识别成 PDF 文本" + 三个动作按钮 |
| A6 | 多份资料可整体问 AI | 勾选 ≥1 份 → "让 AI 一起总结" → 汇总输出（流式） |
| A7 | 原件预览下线 | 前端不再有"原件页加载失败"弹窗；`/original/` 路由保留兼容但 UI 入口删除 |
| A8 | mx 类单列金额格式可解析 | 用 mx 原件回归，`quality=invalid` 比例从 **100% 降到 <10%**，方向/金额正确 |
| A9 | 全链路回滚可用 | 部署前备份二进制 + dist；回滚命令写进文档 |
| A10 | 不回归 | 三份申报表仍 `form/ok/36栏次`；标准 CSV/XLSX/DOCX/PDF 仍 `ok` |

---

## 三、工作包分解（按依赖顺序）

### W1. 后端：修 chat 超时 + 流式输出（核心，先做）

**改动文件**
- `server/workbench.go`
- `server/structure_rescue.go`
- `server/general_parse.go`
- `server/main.go`

**1.1 超时分离（修 B1）**

```go
// workbench.go
const (
    wbChatTimeout = 180 * time.Second  // 模型推理
    wbAPITimeout  = 15 * time.Second   // 普通 API（余额、上传、文档）
)
```

- `wb.do` 保持 15s（普通接口）。
- 新增 `wb.doLong(ctx, ...)` 或给 chat 请求单独 `context.WithTimeout(180s)`；参照 OCR 的写法 `workbench.go:648-655`。
- **不改** `wbRefreshWaitTimeout`（30s）语义，但 refresh 走独立 client，避免被 chat 长请求占用。

**1.2 流式（SSE）**

- 先探测：workbench `/v1/chat/completions` 是否支持 `stream:true`（发一次 `{"stream":true}` 看是否返回 `text/event-stream`）。
  - **支持** → qingliu 透传 SSE。
  - **不支持** → 降级方案：分阶段进度事件（`classify → extract → verify → done`），仍然"边跑边显示阶段"，不是假流式。
- 新增 `POST /api/clients/{cid}/documents/{did}/general-parse/stream`
  - `Content-Type: text/event-stream`
  - 事件：`{"type":"delta","text":"..."}` / `{"type":"stage","name":"..."}` / `{"type":"done","result":{...}}` / `{"type":"error","code":"...","message":"..."}`
  - 结束后照旧写 `payload.general_parse`
- 保留老的同步接口（不破坏现有调用/测试）。

**1.3 错误分类（A3）**

新建 `wbErrCode(err)`：`timeout | quota | model_unavailable | empty_input | auth | unknown`，每个都有中英文案，前端直接显示"模型响应超时（已等 180 秒），可重试或换更短的资料"。

**1.4 批量总结（A6）**

- `POST /api/clients/{cid}/documents/summarize`：body `{document_ids:[...], question?}`
- 取每份 `extract_text` 截断后拼接（总量上限 20000 字），单次调模型，流式返回。
- 结果存 `ql_customers.meta.batch_summary`（或独立 payload key），不写 `ql_transactions`。

### W2. 后端：mx 类单列金额格式适配（A8）

**改动文件**：`server/parser.go`（文本层行解析）、`server/domain.go`（classify）

**做法（增量、不重写）**
1. 在行解析后加一道「金额/余额拆分」推断：当 `amount` 有值但 `income/expense` 都为空、且 `raw` 里存在两个数字时，按"交易额 + 余额"模式拆分（余额 = 累计，可由相邻行校验）。
2. 方向推断优先级：`+/-` 符号 → 关键词（付息/利息支出=expense，收入/入账=income）→ 余额差分（`balance[i]-balance[i-1] > 0` → income）。
3. 拆不出来时 **不要** 直接判 invalid，标记 `quality=review` + 明确 error（"金额与余额粘连，需人工确认"），让 UI 显示为"待核对"而不是"解析失败"。
4. 加单测：用 mx 的真实 `raw` 字符串表驱动。

**边界**：只影响"文本层已抽出正文"的 PDF；扫描件走 OCR 路径不变。

### W3. 前端：AI 提取面板重做（A1/A2/A4）

**改动文件**
- `frontend/src/features/case/components/ParseDetailDialog.jsx`（重做）
- 新建 `frontend/src/features/case/components/AiExtractPanel.jsx`
- `frontend/src/features/case/api.js`（加 stream / summarize）
- `frontend/src/features/case/components/parse-detail.css`

**交互细节（按钮级）**

| 元素 | 位置 | 行为 |
| --- | --- | --- |
| 预设下拉 | 面板顶部左侧 | 默认"提取单据关键信息"；含 4 个预设 + 自定义 |
| 自定义输入框 | 预设选"自定义"时出现 | 占位符"描述你想要的结果，例如：按月份汇总收入" |
| 主按钮 `开始解析` | 顶部右侧 | 空输入禁用；点击 → loading（按钮内转圈 + 文案"解析中…"）；不可重复点击 |
| 流式区 | 面板主体 | 首字 ≤2s；等宽字体、自动滚到底；`aria-live="polite"` |
| 结果区 | 流式结束后 | Markdown 表格渲染（复用 `MarkdownTable`）；字段键值表在表格上方 |
| 复制按钮 `复制` | 结果区右上 | 复制 Markdown；成功 toast"已复制"；失败 toast"复制失败，请手动选择" |
| 导出按钮 `导出` | 结果区右上 | 下载 `{文档名}-解析结果.md` + `.csv`（有 fields 时） |
| 重试按钮 `重试` | 出错时的错误卡内 | 沿用当前预设重跑 |
| 关闭 | 右上 × | 流式进行中关闭 → `AbortController.abort()`，后端 ctx 取消 |
| 复制失败兜底 | — | 显示可全选的 `<textarea readonly>` |

**状态机**：`idle → running → streaming → done | error`，每个状态对应明确 UI，不允许"卡在 running 无反馈"。

**安全**：保持现有"只渲染表格、不 dangerouslySetInnerHTML"策略。

### W4. 前端：不支持资料的分流与引导（A5）

**改动文件**
- `UploadStep.jsx` / `ParseRecordsPanel.jsx`
- 新建 `UnsupportedDocGuide.jsx`
- locale 文件

**判定**：`doc_type=freeform` 且不属于任何已知业务类型（或 `method=workbench-structure` 且无字段）→ 标记 `needsFlow: "unsupported"`。

**交互**
1. 该记录在列表里显示徽章「已识别 · 暂不支持核对流程」。
2. 点开弹窗顶部一条说明条：
   > 该资料暂不支持后续核对流程，已为你识别成 PDF 文本。
3. 三个动作按钮：
   - `看看识别出了什么` → 展示 extract_text / facts（表格化）
   - `让 AI 提取要点` → 走 W3 面板
   - `和我勾选的其他资料一起总结` → 走 W1.4 批量总结
4. 列表中勾选多份时可批量总结（复用 W3 的流式渲染）。

### W5. 前端：下线原件预览（A7）

- 删除 `OriginalEvidenceDialog.jsx` 的**引用入口**（"对照原件"按钮）与"加载原件"入口。
- 保留文件本身 + `/original/` 路由（避免历史数据/其他调用 404），但在 README/注释标注 deprecated。
- 受影响位置：`review` 步骤的"对照原件"按钮（`review.btn_view_original`）。
- 替代：在交易行上显示 `原件位置` 文本（`文件名，第 N 页，pdf:row:N`），可选中复制。

### W6. 收尾与治理

1. 生产部署脚本固化（`deploy/` 下补 `deploy-prod.sh`：备份 → 上传 → 装 → 重启 → health → 失败自动回滚）。
2. 回滚文档：单条命令恢复 `qingliu.bak-<ts>` / `dist.bak-<ts>`。
3. 清理：一次性诊断代码、临时脚本、QA 客户数据。
4. 文档更新：本文件回填"实测结果"章节。

---

## 四、测试矩阵（必须逐条跑绿）

### T1. 单元/集成（本地）

| 用例 | 方式 | 期望 |
| --- | --- | --- |
| chat 超时不误杀 | 打桩 worker 延迟 20s | 成功（180s 内） |
| 流式事件序列 | 打桩 SSE | stage* → delta* → done |
| 错误分类 | 打桩 401/429/timeout/空输入 | 各自对应 code + 人话 |
| mx 单列金额解析 | 表驱动 5 种 raw | 方向/金额正确，invalid 率 <10% |
| 批量总结 | 3 份文档拼接 | 长度截断生效，不超 20000 字 |

### T2. 端到端（本地四服务）

| # | 场景 | 期望 |
| --- | --- | --- |
| E1 | 申报表 → AI 提取（流式） | 首字 ≤2s；36 栏次正确；可复制导出 |
| E2 | mx 19 页流水重解析 | 无效行 <10%；交易核对页不再是全红 |
| E3 | 上传一张图片（不支持资料） | 显示"暂不支持核对流程" + 3 个动作 |
| E4 | 勾选 3 份 → 一起总结 | 流式输出汇总，含每份要点 |
| E5 | 交易核对页不再有"对照原件" | 按钮消失，原件位置可复制 |
| E6 | 回归：CSV/XLSX/DOCX/PDF/扫描件 | 全部仍 `ok`（不回归） |
| E7 | 中途关闭流式 | 后端 ctx 取消，无泄漏 |

### T3. 生产验证（部署后）

| # | 场景 | 期望 |
| --- | --- | --- |
| P1 | 生产点 AI 提取（申报表） | 3/3 成功，无 `temporarily unavailable` |
| P2 | 生产 journal | 无 `context deadline exceeded` |
| P3 | mx 客户交易核对页 | 大量行变 `ok/review`，不再是 1078 全 invalid |
| P4 | 三份申报表 | 仍 `form/ok/36栏次` |
| P5 | 回滚演练 | 备份可启动、health ok |

---

## 五、执行顺序与风险

```
W1(超时+流式) → W2(mx解析) → W3(AI面板) → W4(分流) → W5(下线预览) → W6(收尾)
      ↑ 先做，因为它单独就能修掉"点一下就红条"这个最刺眼的问题
```

| 风险 | 处置 |
| --- | --- |
| workbench 不支持 stream | 降级为阶段进度事件，UI 仍"边跑边显示" |
| 长超时把 proxy 池占满 | chat 走独立 client，不与普通 API 共享连接池；并设并发上限 |
| mx 格式判定误伤其他流水 | 只对"已有正文 + amount 存在但方向缺失"的行启用，且有开关 `QL_ROW_AMOUNT_SPLIT=on` |
| 删预览影响历史报告 | 只删 UI 入口，保留路由与文件 |
| 生产部署失败 | 备份 + 一键回滚脚本，health 探测失败自动回滚 |

---

## 六、需要你确认的 3 个决策点

1. **流式降级可接受吗？** 若 workbench 不支持 `stream:true`，退化为"阶段进度 + 分段渲染"，不是真逐字。是否可以？
2. **W2（mx 解析）范围**：只修"单列金额+余额粘连"，还是把所有 `quality=invalid` 的行都重跑一遍历史数据？
3. **导出格式**：`.md` + `.csv` 够吗？还要不要 `.xlsx`？

> 若你不回复，我按：流式支持降级 / 只修新解析不重跑历史 / 导出 `.md`+`.csv` 执行。
