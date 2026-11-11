package main

import (
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// requestPool 是一档请求准入闸。
//
// 历史缺陷（2026-11-12 生产故障，见 docs/05 §11）：`route()` 里只有一个
// **4 槽**的池子，而且管住全站每一个请求 —— 首页 HTML、`/assets/*.js`、
// `/health` 都在里面。只要四张账单请求（每张都要转发工作台）同时在路上，
// 第五个请求（哪怕是静态资源）立刻 503「当前服务器繁忙」，用户连页面都进不去。
//
// 现在的口径：按**代价**分档，只有真吃 CPU/内存/上游等待的请求才进池，
// 而且满池时先排队、仍满才 503，并带 Retry-After 让前端可以重试。
type requestPool struct {
	name  string
	slots chan struct{}
	// wait 是满池后的排队窗口：瞬时并发靠它吸收，超过就快速失败。
	wait     time.Duration
	rejected atomic.Int64
	lastWarn atomic.Int64
}

func newRequestPool(name string, size int, wait time.Duration) *requestPool {
	if size <= 0 {
		return nil // 显式关闭这一档（例如测试或临时扩容）
	}
	return &requestPool{name: name, slots: make(chan struct{}, size), wait: wait}
}

// enter 抢一个槽，返回 release（没抢到时是空操作）。第二个返回值是是否抢到。
func (p *requestPool) enter() (func(), bool) {
	if p == nil {
		return func() {}, true
	}
	select {
	case p.slots <- struct{}{}:
		return func() { <-p.slots }, true
	default:
	}
	if p.wait <= 0 {
		p.noteRejected()
		return func() {}, false
	}
	timer := time.NewTimer(p.wait)
	defer timer.Stop()
	select {
	case p.slots <- struct{}{}:
		return func() { <-p.slots }, true
	case <-timer.C:
		p.noteRejected()
		return func() {}, false
	}
}

// noteRejected 记一次拒绝，并按 10s 节流打日志：journalctl 里能直接看到是哪一档满了。
func (p *requestPool) noteRejected() {
	total := p.rejected.Add(1)
	now := time.Now().Unix()
	for {
		last := p.lastWarn.Load()
		if now-last < 10 {
			return
		}
		if p.lastWarn.CompareAndSwap(last, now) {
			log.Printf("请求被拒：%s 池已满（排队 %s 后仍无槽，累计 %d 次）", p.name, p.wait, total)
			return
		}
	}
}

// requestPools 是 App 上的分档池。某一档为 nil 表示该档不限流。
type requestPools struct {
	read   *requestPool // 纯读 JSON：DB 毫秒级
	write  *requestPool // 写 JSON：上传入队、核对、提交
	proxy  *requestPool // 转发工作台：等网络，最长 15s
	bulk   *requestPool // 上传：单请求最多缓冲 64MB
	render *requestPool // 原件 PDF 渲染：fork poppler，单页几十 MB
}

// loadRequestPools 读环境变量定档，默认值按实测代价给出（见 docs/05 §12）：
//
//	read   64：0.1–2ms 一个，4 档时代完全不必要，放宽到 64
//	write  32：10–500ms 一个
//	proxy  32：转发工作台，主要消耗等待而不是本机 CPU
//	bulk    2：64MB × 2 = 128MB 缓冲，配合 MemoryMax=1G 留足余量
//	render  4：poppler 子进程，是这台机器唯一真需要闸的地方
func loadRequestPools() requestPools {
	return requestPools{
		read:   newRequestPool("read", envInt("QL_POOL_READ", 64), 200*time.Millisecond),
		write:  newRequestPool("write", envInt("QL_POOL_WRITE", 32), 500*time.Millisecond),
		proxy:  newRequestPool("proxy", envInt("QL_POOL_PROXY", 32), 300*time.Millisecond),
		bulk:   newRequestPool("bulk", envInt("QL_POOL_BULK", 2), time.Second),
		render: newRequestPool("render", envInt("QL_POOL_RENDER", 4), 2*time.Second),
	}
}

// poolFor 给请求选档；返回 nil 表示不入池（静态资源、SPA 页面、健康检查）。
//
// 顺序有讲究：先按「不吃资源」放行，再按代价从重到轻匹配，最后才落到读写。
func (a *App) poolFor(r *http.Request) *requestPool {
	p := &a.pools
	path := r.URL.Path
	// 不占资源的请求直接放行：/health 被业务拖累就没法做探活；
	// /assets/*.js、*.svg、SPA 的 index.html 只是读磁盘，占槽毫无意义。
	if !strings.HasPrefix(path, "/api/") {
		return nil
	}
	switch {
	case strings.Contains(path, "/original/"):
		return p.render
	case strings.HasSuffix(path, "/upload") || strings.HasSuffix(path, "/upload-parsed"):
		return p.bulk
	case path == "/api/spaces" || strings.HasPrefix(path, "/api/spaces/") ||
		path == "/api/switch-space" ||
		strings.HasPrefix(path, "/api/billing/") || strings.HasPrefix(path, "/api/service/"):
		return p.proxy
	case r.Method == "GET" || r.Method == "HEAD":
		return p.read
	default:
		return p.write
	}
}
