# 技术方案：响应式 API 迁移（Responses）与上限封顶

> 配套总纲：`docs/需求与目标-Responses迁移与上限封顶.md`
> 状态：调查完成，方案待批，**未执行**
> 调查时间：2026-11-21

---

## 一、调查结论（全部有证据）

### 1.1 官方硬限值（`api-docs.deepseek.com`）

| 项 | 值 | 来源 |
| --- | --- | --- |
| 上下文长度 | **1M** | `/zh-cn/quick_start/pricing` |
| 输出长度 | **最大 384K = 393216** | 同上 |
| Responses API | 支持，`POST /responses` | `/zh-cn/api/create-response` |
| 关闭思考 | `reasoning.effort = "none"` | 同上（`none` 关闭；`low/high/max` 开启；不传=默认开启） |
| 输出上限字段 | `max_output_tokens`（**含思维链 token**） | 同上 |
| 流式终帧 | `response.completed` / `response.incomplete` / `response.failed` | 同上，**没有 `data: [DONE]`** |
| 结构化输出 | `text.format.type = json_object / json_schema` | 同上 |

### 1.2 当前链路的三个截断源（实测）

**证据 A：qingliu 侧硬编码**

```go
// server/wb_stream.go（改造前）
"max_tokens": 1500  → 4000 → 8000 → 12000   // 一路调，仍被截断
```

**证据 B：工作台两道收敛**

```go
// llmgateway/gateway.go:412  applyMaxTokensCap        → 全局 max_tokens_cap（默认 32768）
// llmgateway/gateway.go:430  applyModelMaxOutputTokens → 定价表 max_output_tokens
```

实测 `t_model_pricing` 里 `auto`：`max_output_tokens = 30000`，`context_window = 2000000`。
→ qingliu 传多大都会被收敛到 **min(32768, 30000) = 30000**。

**证据 C：`reasoning_effort:"off"` 根本不关闭思考**

```go
// llmwire/reasoning.go:26
// WireReasoningEffort 决定编码上游时是否写出 reasoning_effort（off 与空不写）。
func WireReasoningEffort(req *Request) *string {
	effort := ReasoningEffortString(req)
	if effort == "" || effort == "off" {
		return nil        // ← 直接不写这个字段
	}
	return &effort
}
```

DeepSeek 文档明写：*"不传时使用模型默认的思考行为（**默认开启**）"*。
→ `off` = 不转发 = 上游以为你没指定 = **开启思考**。

实测验证（申报表 2439 prompt tokens）：

| max_tokens | reasoning 帧 | content 帧 | finish_reason | completion_tokens |
| --- | --- | --- | --- | --- |
| 4000 | 4000 | **0** | length（截断） | 4000 |
| 8000 | 2441 | 620 | stop | 3062 |
| 12000 | — | 980 | stop | 3517 |
| 16000 | — | 1405 | stop | 5947 |

→ 思考链稳定吃掉 2400+ tokens，预算不够时正文直接为 0。

**证据 D（关键缺口）：工作台的 Responses 编码与 DeepSeek 不一致**

```go
// llmwire/openai_responses.go:59 / :406
ReasoningEffort *string `json:"reasoning_effort,omitempty"`   // 扁平字段
...
ReasoningEffort: WireReasoningEffort(req),                     // 写出扁平的 reasoning_effort
```

但 DeepSeek 的 Responses API 要的是**嵌套结构**：

```json
{ "reasoning": { "effort": "none" } }
```

→ **即使清流改传 `"none"`，工作台也不会正确编码成嵌套 reasoning，上游仍按默认开思考。**
这是必须先修的**后端 bug**，否则迁移到 Responses 也治不好截断。

---

## 二、后端改造（不加班智能团后端）

### B1. `responsesRequest` 增加嵌套 reasoning

**文件**：`internal/llmwire/openai_responses.go`

```go
// 新增
type responsesReasoning struct {
    Effort string `json:"effort,omitempty"`
}

type responsesRequest struct {
    ...
    Reasoning    *responsesReasoning `json:"reasoning,omitempty"`   // 新增：嵌套
    // ReasoningEffort 保留给兼容（部分上游仍认扁平字段），但不再用于 DeepSeek 方言
}
```

编码时：
- `effort == "none"` → `{"reasoning":{"effort":"none"}}`
- `effort == "off"` → **规范化为 `"none"`**（兼容旧调用方语义："我要关闭"）
- `effort == "low"/"high"/"max"` → 原样嵌套
- 空 → 不写（走上游默认）

### B2. `off` 语义修正（全方言）

**文件**：`internal/llmwire/reasoning.go`

```go
// 新增：把 off 规范成各上游真实支持的"关闭"表达
func WireReasoningEffortCanonical(req *Request) *string {
    effort := ReasoningEffortString(req)
    if effort == "off" {
        return ptr("none")   // DeepSeek/OpenAI 系认 none
    }
    if effort == "" { return nil }
    return &effort
}
```

对 Chat 方言（`openai_chat.go`）同样处理：`off → none` 或 `thinking:{type:"disabled"}`。

> ⚠️ 这会改变现有 Chat 调用方的行为（`off` 从"不传"变成"明确关闭"）。
> 这是**预期内的修正**——你要的就是"老参数别再有歧义"。

### B3. 上限封顶：把"限制"降级为"保险丝"

**文件**：`internal/llmgateway/gateway.go`、`internal/llmgateway/settings.go`、迁移文件

| 参数 | 现状 | 改为 |
| --- | --- | --- |
| `Settings.MaxTokensCap` | 32768，硬收敛 | 提到 **393216**（官方最大），仅防打爆 |
| `t_model_pricing.max_output_tokens`（auto） | 30000 | 提到模型真实上限；或允许 NULL 表示"不额外收敛" |
| `applyModelMaxOutputTokens` | `min(req, model_max)` | 保留逻辑但 model_max 用真实上限，不再人为压低 |
| `platform_key_daily_tokens` | 有限额 | 解析服务改为 0（不限） |

**原则**：上限字段继续存在（防止误传 10 亿打爆账单），但**不再作为业务截断手段**。

### B4. 新增"解析专用"路径（可选，推荐）

给 qingliu 这类内部服务一个明确契约，避免和对外 API 共用限制：

```
POST /v1/responses
X-Service-Client: qingliu
→ 服务身份自动获得：max_output_tokens 封顶、不做 daily_tokens 限制、reasoning 默认 none
```

好处：不影响对外用户额度策略，内部服务要满就给满。

---

## 三、清流改造（qingliu-workspace/server）

### C1. 调用点迁移（共 7 处 → 3 个函数）

| 文件 | 位置 | 现状 | 改为 |
| --- | --- | --- | --- |
| `structure_rescue.go:162,170` | `wbChatText` | `POST /v1/chat/completions` | `POST /v1/responses` |
| `wb_stream.go:182,188` | `wbChatStream` | 同上（流式） | 同上 |
| `workbench.go:35` | 注释 | 提到 chat | 更新注释 |

**请求体映射**

```
Chat Completions                    →   Responses
messages:[{role,content}]           →   input: [{type:"message",role,content:[{type:"input_text",text}]}]
                                      （或直接 input: "纯文本字符串"）
temperature                         →   temperature
max_tokens                          →   max_output_tokens = wbChatMaxTokens()  // 393216
reasoning_effort: "off"             →   reasoning: {effort: "none"}
（JSON 模式用 prompt 约束）          →   text: {format: {type: "json_object"}}
                                      store: false
```

**响应解析映射**

```
choices[0].message.content          →   output[] 里 type=="message" 的 content[].text（type=="output_text"）
finish_reason                       →   status: completed/incomplete/failed
                                    →   incomplete_details.reason
usage.prompt/completion_tokens      →   usage.input_tokens / output_tokens
```

**流式事件映射**

```
data: {choices[0].delta.content}    →   event: response.output_text.delta  { delta }
data: {reasoning_content}           →   response.reasoning_summary_text.delta
data: [DONE]                        →   response.completed  （无 DONE！）
                                    或  response.incomplete / response.failed
```

> **重要**：现在 `wbStreamRequest` 靠 `payload == "[DONE]"` 判断结束。
> 迁 Responses 后必须改成按事件名 `response.completed|incomplete|failed` 判断，否则**永远读不到结束**。

### C2. 上限封顶

```go
// wb_stream.go
const wbChatDefaultMaxTokens = 393216   // 官方输出上限，交给上游真正截断
```
- 字段名从 `max_tokens` 改为 `max_output_tokens`
- 保持 `QL_CHAT_MAX_TOKENS` 环境变量可覆盖（应急降档用）

### C3. 截断检测改为调 official 字段

```go
// 现在：靠"有 reasoning 但没 content"猜
// 改为：读 status / incomplete_details.reason
if status == "incomplete" && reason == "max_output_tokens" {
    return WBError{Code: "truncated", Message: "输出被模型上限截断，请缩小资料范围"}
}
```

### C4. 其他调用点确认

搜索结果：qingliu 侧只有 `structure_rescue.go` / `wb_stream.go` 两处真正发 chat 请求。
OCR 走 `/v1/ocr`（不在本次范围），上传走 `/api/v1/ai/documents`（不在范围）。

---

## 四、前端改造

| 项 | 改动 |
| --- | --- |
| SSE 消费 | 按事件名解析（`response.output_text.delta` / `response.completed`），不再等 `[DONE]` |
| 截断提示 | 读 `incomplete_details.reason` 显示"输出被截断" |
| 错误码 | 新 code：`truncated` / `timeout` / `quota` / `auth` / `model_unavailable` |
| AI 提取面板 | 按 W3 计划重做（流式区、复制、导出、重试、取消） |

---

## 五、测试矩阵

### T1 后端单测（不加班）

| 用例 | 期望 |
| --- | --- |
| `effort:"off"` 编码 | 上游收到 `{"reasoning":{"effort":"none"}}`，不再省略 |
| `effort:"none"` 编码 | 同上 |
| `effort:""` | 不写 reasoning 字段 |
| `max_output_tokens` 透传 | 393216 不被收敛（或收敛到模型真实上限） |
| Responses 流式编码 | 产生 `response.output_text.delta` 帧与 `response.completed` 终帧 |

### T2 清流单测

| 用例 | 期望 |
| --- | --- |
| `parseResponsesDone` | `completed`/`incomplete`/`failed` 都能正确结束 |
| 无 `[DONE]` 时不死循环 | 读到 completed 立即返回 |
| `incomplete_details=reason:max_output_tokens` | 返回 `truncated` 错误码 |
| 响应文本抽取 | `output[]` 里多 item 时只取 message 的 output_text |

### T3 端到端（本地）

| 用例 | 期望 |
| --- | --- |
| 申报表 AI 提取（流式） | 首字 ≤2s；无截断；36 栏次正确 |
| 连续 3 次同一文档 | 3/3 成功，`incomplete` 出现 0 次 |
| 关闭思考验证 | 响应无 `reasoning` item，耗时下降 |
| 三份申报表解析 | 仍 `form/ok/36栏次` |
| mx 流水 | 仍 675 行（不回归） |

### T4 生产验证

| 用例 | 期望 |
| --- | --- |
| 生产 AI 提取 | 3/3 成功，无 `temporarily unavailable` |
| journal | 无 `context deadline exceeded` |
| 截断 | 无 `max_output_tokens` incomplete |

---

## 六、上线与回滚

```bash
# 部署（先备份）
cp /opt/qingliu/qingliu /opt/qingliu/qingliu.bak-$(date +%Y%m%d-%H%M%S)
cp -a /opt/qingliu/frontend/dist /opt/qingliu/frontend/dist.bak-$(date +%Y%m%d-%H%M%S)
systemctl restart qingliu.service
curl -sf http://127.0.0.1:8787/health || <回滚>

# 回滚
cp /opt/qingliu/qingliu.bak-<ts> /opt/qingliu/qingliu
cp -a /opt/qingliu/frontend/dist.bak-<ts>/. /opt/qingliu/frontend/dist/
systemctl restart qingliu.service
```

**不加班后端**独立部署，需同时上线（否则清流转 Responses 会因 reasoning 结构不对仍被截断）。**顺序：先后端，后清流。**

---

## 七、待推送清单（**你决策后我才推**）

### 仓库一：`不加班智能团后端`

| 文件 | 改动 |
| --- | --- |
| `internal/llmwire/openai_responses.go` | 新增嵌套 `reasoning` 结构；`max_output_tokens` 编码 |
| `internal/llmwire/reasoning.go` | `off → none` 规范化 |
| `internal/llmwire/openai_chat.go` | 同步 `off → none` |
| `internal/llmgateway/gateway.go` | `MaxTokensCap` 提到 393216；模型上限不再人为压低 |
| `internal/llmgateway/settings.go` + 迁移 | 新默认值 |
| `internal/llmwire/*_test.go` | 新增编码测试 |

### 仓库二：`qingliu-workspace`

| 文件 | 改动 |
| --- | --- |
| `server/wb_stream.go` | 迁移 Responses + SSE 事件适配 + `max_output_tokens` 封顶 |
| `server/structure_rescue.go` | 同步路径迁 Responses |
| `server/workbench.go` | 超时分档（已完成） |
| `server/sse.go` | 对前端的 SSE（已完成） |
| `server/main.go` | 流式接口 + 批量总结接口（已完成部分） |
| `frontend/src/features/case/components/ParseDetailDialog.jsx` 等 | 面板重做（W3） |
| `docs/` 两份新文档 | 需求总纲 + 技术方案 |

**提交信息建议**：
- 后端：`feat(llmwire): Responses API 支持嵌套 reasoning 与输出上限封顶`
- 清流：`feat(parse): 模型调用迁移 Responses API，输出上限封顶到 384K，AI 提取改流式`

---

## 八、风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 后端先改会改变现有 Chat 调用方行为（`off` 不再等于"不传"） | 其他服务可能变快或变慢 | 提前告知；可用环境变量回退 |
| 清流先改会因后端未上线而仍被截断 | 上线顺序必须"先后端后清流" | 写进部署脚本校验 |
| 393216 上限可能让单次请求变贵 | 成本上升 | 解析任务本身输出有限，实测 6000 tokens 就够；上限只是保险丝 |
| Responses 无 `[DONE]`，旧代码会卡住 | 流永不结束 | T2 单测强制覆盖；本地 E2E 验证 |

---

## 九、我不确定、需要你确认的

1. **后端改动是否允许动 `internal/llmwire`（共享层）**？这会同时影响其它走 Chat 的服务。
2. **要不要保留 `off` 作为合法值**（内部规范化为 none），还是直接要求调用方改用 `none`？
3. **`max_tokens_cap` 是改大还是彻底跳过**？改大更安全，跳过更彻底。
4. **上线顺序**：能否接受"先后端、后清流"的两步发布（中间会有短暂不一致窗口）？
