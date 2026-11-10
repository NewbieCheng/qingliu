package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// 文档解析计价：单价由工作台管理后台「财务 → 解析计价」维护，
// 清流只负责读取与扣费。价格**绝不写死在这里** —— 运营调价后，
// 下一次解析就按新价扣，无需重启清流。
//
// 三档对应三条解析路径：
//   text   有文字层，直接提取，按份
//   ocr    本机 tesseract 逐页识别，按页
//   vision 视觉模型逐页识别，按页
type parsePricing struct {
	Text   int64 // 每份
	OCR    int64 // 每页
	Vision int64 // 每页
}

// parsePricingCache 缓存 60 秒：解析是批量任务，每个任务都回源会放大
// 工作台压力；60 秒的延迟对调价体验可以忽略。
type parsePricingCache struct {
	mu       sync.Mutex
	value    parsePricing
	loadedAt time.Time
}

const parsePricingTTL = 60 * time.Second

var errPricingChargeFailed = errors.New("积分扣费失败，请联系管理员")

// insufficientPointsMessage 是所有「计费解析入口」对余额不足的统一文案。
// 三种状态（上传解析、AI 解析、文档 OCR）共用一句话，前端按 402 拉起
// 「前往充值」对话框，用户不需要在不同页面读不同的说法。
const insufficientPointsMessage = "积分不足：AI 解析与文档解析按积分计费，请先充值再试"

// loadPricing 拉取当前解析计价。读不到时返回 0（不扣费）而不是报错：
// 计费配置故障不该让用户无法解析，运营可从账单侧对账。
func (a *App) loadPricing(ctx context.Context) parsePricing {
	a.pricing.mu.Lock()
	defer a.pricing.mu.Unlock()
	if !a.pricing.loadedAt.IsZero() && time.Since(a.pricing.loadedAt) < parsePricingTTL {
		return a.pricing.value
	}
	status, data, err := a.wb.serviceRequest(ctx, http.MethodGet, "/api/v1/service/billing/parse-pricing", nil)
	if err != nil || status != http.StatusOK {
		// 读不到就沿用上次的值；首次失败时为 0（不扣费），并留下日志，
		// 避免「运营以为在收费、实际一直免费」这种无声漏收。
		log.Printf("parse pricing load failed: status=%d err=%v", status, err)
		return a.pricing.value
	}
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	pricing := parsePricing{
		Text:   integer(payload["text_points_per_document"]),
		OCR:    integer(payload["ocr_points_per_page"]),
		Vision: integer(payload["vision_points_per_page"]),
	}
	a.pricing.value = pricing
	a.pricing.loadedAt = time.Now()
	return pricing
}

// parseCost 按实际走的路径算这份文档该扣多少积分。
func (p parsePricing) parseCost(method string, pages int) int64 {
	switch method {
	case "text":
		return p.Text
	case "ocr":
		if pages < 1 {
			pages = 1
		}
		return p.OCR * int64(pages)
	case "vision":
		if pages < 1 {
			pages = 1
		}
		return p.Vision * int64(pages)
	default:
		return 0
	}
}

// chargeParse 解析成功后扣积分。
//
// 「成功后才扣」：失败或没拿到结果就不扣，用户不会为没得到的东西付费。
// batch 用解析任务 id，工作台按 batch_trace_id 幂等，重试不会重复扣。
func (a *App) chargeParse(ctx context.Context, userID, jobID, method string, pages int) (int64, error) {
	points := a.loadPricing(ctx).parseCost(method, pages)
	if points <= 0 {
		return 0, nil
	}
	account := a.wbAccount(userID)
	if account == nil || integer(account["workbench_user_id"]) == 0 {
		// 本地过渡账号没有绑定工作台身份，无从扣费。记日志而不是静默跳过：
		// 「解析成功但没扣费」必须能在运维侧看见，否则会变成长期漏收。
		log.Printf("parse charge skipped: user=%s job=%s has no workbench identity", userID, jobID)
		return 0, nil
	}
	status, data, err := a.wb.serviceRequest(ctx, http.MethodPost, "/api/v1/service/billing/charge", Object{
		"workbench_user_id": integer(account["workbench_user_id"]),
		"batch_trace_id":    "qingliu-parse-" + jobID,
		"points":            points,
		"reason":            "qingliu_parse_" + method,
		"note":              "清流文档解析：" + method + "，" + itoa(int64(pages)) + " 页",
	})
	if err != nil {
		log.Printf("parse charge failed: job=%s points=%d err=%v", jobID, points, err)
		return 0, err
	}
	if status < 200 || status >= 300 {
		log.Printf("parse charge rejected: job=%s points=%d status=%d body=%s", jobID, points, status, wbMessage(data, ""))
		return 0, errPricingChargeFailed
	}
	log.Printf("parse charge ok: job=%s method=%s pages=%d points=%d", jobID, method, pages, points)
	return points, nil
}

// parseBillingTier 把解析实际走的方法归到计价档位。
//
// 只认三条路：纯文本提取 / 本机 OCR / 视觉模型。表格导入（CSV/XLSX）没有
// 模型成本，按最低档处理，运营若想免费可把该档调成 0。
func parseBillingTier(result ParseResult) string {
	method := strings.ToLower(str(result.Meta, "method"))
	switch {
	case strings.Contains(method, "vision"), strings.Contains(method, "model"):
		return "vision"
	case strings.Contains(method, "ocr"), strings.Contains(method, "tesseract"):
		return "ocr"
	case strings.Contains(method, "standard-import"):
		return "text"
	default:
		return "text"
	}
}

// pointBalance 读取当前用户积分余额。
//
// 第二个返回值表示「余额是否可信」：工作台不可达时返回 false，调用方据此
// 放行而不是拒绝 —— 计费查询失败不该让用户无法上传资料。
func (a *App) pointBalance(ctx context.Context, userID string) (int64, bool) {
	status, data, err := a.wbRequest(ctx, userID, http.MethodGet, "/api/v1/account/balance", nil)
	if err != nil || status != http.StatusOK {
		return 0, false
	}
	// 工作台返回 {data:{points_balance, period_points_balance, available_points}}；
	// sub() 直接取嵌套对象，用 obj(str(...)) 会把对象转成字符串再解析，永远得到空 map。
	payload := sub(data, "data")
	if payload == nil {
		payload = data
	}
	// 可用额度 = 永久桶 + 本期桶（订阅发放的积分全在本期桶，到期作废）。
	// 只读 points_balance 会把「充了月度套餐」的账号判成 0 分：2026-11-10 线上
	// 用户付款成功后仍被 402 挡住，就是这个口径差。available_points 由工作台
	// 统一汇总，有就优先用，避免两边各算一遍。
	if available := integer(payload["available_points"]); available > 0 {
		return available, true
	}
	return integer(payload["points_balance"]) + integer(payload["period_points_balance"]), true
}
