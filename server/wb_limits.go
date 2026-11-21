package main

// wb_limits.go —— 模型参数统一来源于后端，清流不写死任何魔法数字。
//
// 铁律（见 docs/终极改造方案-清流瘦身与能力归一.md §二 L1）：
//   清流不声明"要多少 token / 开不开思考"，只说"给我解析结果"；
//   上限与档位的真实来源是后端定价表（t_model_pricing）与网关设置。
//
// 以前的写法（已废弃）：
//   "max_tokens": 1500 → 4000 → 8000 → 12000   // 一路调，仍被思考链吃光
// 现在的写法：
//   "max_output_tokens": wbMaxOutputTokens()   // 后端配置说了算
//   "reasoning": {"effort": wbReasoningEffort()} // 后端配置说了算，映射由后端做

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 官方兜底值：只在读不到后端配置时使用。
// 来源：api-docs.deepseek.com/zh-cn/quick_start/pricing（上下文 1M / 输出最大 384K）。
const (
	wbFallbackMaxOutputTokens = 393216
	wbFallbackReasoningEffort = "off" // 内部档位；由后端按模型映射成 none/off/null
)

// 模型能力缓存时长：解析是批量任务，5 分钟的延迟可接受。
const wbLimitsTTL = 5 * time.Minute

type wbLimits struct {
	MaxOutputTokens int
	ReasoningEffort string
	loadedAt        time.Time
}

var wbLimitsCache struct {
	mu    sync.Mutex
	value wbLimits
}

// wbMaxOutputTokens 返回本次调用该请求的输出上限。
// 优先环境变量（应急降档），其次后端配置，最后官方兜底。
func (a *App) wbMaxOutputTokens(ctx context.Context, userID string) int {
	if v := strings.TrimSpace(os.Getenv("QL_CHAT_MAX_TOKENS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return a.wbLimitsValue(ctx, userID).MaxOutputTokens
}

// wbReasoningEffort 返回内部思考档位（off/low/high/max）。
// 真正的"该模型认什么表达"由后端 thinking_level_map 翻译，清流不参与。
func (a *App) wbReasoningEffort(ctx context.Context, userID string) string {
	if v := strings.TrimSpace(os.Getenv("QL_CHAT_REASONING")); v != "" {
		return v
	}
	return a.wbLimitsValue(ctx, userID).ReasoningEffort
}

// wbLimitsValue 读缓存；过期则回源后端 /v1/models 取当前模型的真实能力。
//
// userID 必须传当前请求的用户：/v1/models 需要用户令牌，传空会 401，
// 那样就永远只能拿到兜底值（配置改了对清流不生效）。
//
// 读不到不报错：解析链路不能因为"查配置失败"就停摆，用官方兜底值继续，
// 并留日志便于运维发现（与 pricing.go 的"读不到就沿用上次"同一策略）。
func (a *App) wbLimitsValue(ctx context.Context, userID string) wbLimits {
	wbLimitsCache.mu.Lock()
	defer wbLimitsCache.mu.Unlock()
	if !wbLimitsCache.value.loadedAt.IsZero() && time.Since(wbLimitsCache.value.loadedAt) < wbLimitsTTL {
		return wbLimitsCache.value
	}
	value := wbLimits{MaxOutputTokens: wbFallbackMaxOutputTokens, ReasoningEffort: wbFallbackReasoningEffort}
	if a != nil && a.wb.Ready() && strings.TrimSpace(userID) != "" {
		if limit, effort, ok := a.fetchModelLimits(ctx, userID); ok {
			if limit > 0 {
				value.MaxOutputTokens = limit
			}
			if effort != "" {
				value.ReasoningEffort = effort
			}
		} else {
			log.Printf("wb limits: fallback to official defaults (max_output=%d effort=%s)", value.MaxOutputTokens, value.ReasoningEffort)
		}
	}
	value.loadedAt = time.Now()
	wbLimitsCache.value = value
	return value
}

// resetWBLimits 供测试与配置变更时主动失效缓存。
func resetWBLimits() {
	wbLimitsCache.mu.Lock()
	wbLimitsCache.value = wbLimits{}
	wbLimitsCache.mu.Unlock()
}

// fetchModelLimits 从后端模型目录读当前模型的 max_output_tokens 与推荐档位。
//
// 兼容两种返回形状：
//   - {"data":[{"id":"auto","max_output_tokens":393216,...}]}   模型列表
//   - {"data":{"id":"auto","max_output_tokens":...}}             单模型
//
// 找不到字段就返回 ok=false，让调用方用兜底值。
func (a *App) fetchModelLimits(ctx context.Context, userID string) (int, string, bool) {
	model := structureRescueModel()
	status, data, err := a.wbRequest(ctx, userID, http.MethodGet, "/v1/models", nil)
	if err != nil || status != http.StatusOK {
		log.Printf("wb limits: /v1/models status=%d err=%v", status, err)
		return 0, "", false
	}
	items := list(data["data"])
	if len(items) == 0 {
		items = list(nil)
	}
	var chosen Object
	for _, item := range items {
		entry, _ := item.(map[string]any)
		if entry == nil {
			continue
		}
		if str(entry, "id") == model {
			chosen = entry
			break
		}
		if chosen == nil {
			chosen = entry // 没匹配到就用第一条（curated 模式下通常就是 auto）
		}
	}
	if chosen == nil {
		if nestedEntry := sub(data, "data"); nestedEntry != nil {
			chosen = nestedEntry
		}
	}
	if chosen == nil {
		return 0, "", false
	}
	limit := int(integer(chosen["max_output_tokens"]))
	if limit <= 0 {
		limit = int(integer(chosen["max_tokens"]))
	}
	effort := strings.TrimSpace(str(chosen, "default_reasoning_effort"))
	if effort == "" {
		effort = strings.TrimSpace(str(chosen, "reasoning_effort"))
	}
	if limit <= 0 && effort == "" {
		return 0, "", false
	}
	return limit, effort, true
}
