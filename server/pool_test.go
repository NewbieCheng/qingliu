package main

import (
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// TestPoolForBypassesCheapRequests 固定「哪些请求根本不该排队」这条口径：
// /health 与静态资源一旦被业务拖累，站点就会在「进程 active」的情况下整体 503。
func TestPoolForBypassesCheapRequests(t *testing.T) {
	a := &App{pools: loadRequestPools()}
	for _, path := range []string{"/health", "/", "/login", "/recharge", "/assets/index-abc.js", "/qingliu-icon.svg"} {
		r := httptest.NewRequest("GET", path, nil)
		if got := a.poolFor(r); got != nil {
			t.Fatalf("%s 不该入池，实际进了 %s", path, got.name)
		}
	}
}

// TestPoolForClassifiesByCost 固定「谁进哪一档」。改档名或判据都要同步这里。
func TestPoolForClassifiesByCost(t *testing.T) {
	a := &App{pools: loadRequestPools()}
	cases := []struct {
		method, path, want string
	}{
		{"GET", "/api/me", "read"},
		{"GET", "/api/clients?q=&page=1", "read"},
		{"POST", "/api/clients", "write"},
		{"POST", "/api/clients/c1/review", "write"},
		{"GET", "/api/billing/balance", "proxy"},
		{"GET", "/api/billing/skus", "proxy"},
		{"GET", "/api/spaces", "proxy"},
		{"POST", "/api/switch-space", "proxy"},
		{"POST", "/api/clients/c1/upload", "bulk"},
		{"POST", "/api/clients/c1/upload-parsed", "bulk"},
		{"GET", "/api/clients/c1/original/d1/3", "render"},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, c.path, nil)
		got := a.poolFor(r)
		if got == nil {
			t.Fatalf("%s %s 应该进 %s 池，实际不入池", c.method, c.path, c.want)
		}
		if got.name != c.want {
			t.Fatalf("%s %s = %s 池，want %s", c.method, c.path, got.name, c.want)
		}
	}
}

// TestRequestPoolQueuesThenRejects 验证满池行为：先排队 wait，仍满才拒绝，
// 并且拒绝前不会误占槽。
func TestRequestPoolQueuesThenRejects(t *testing.T) {
	p := newRequestPool("t", 1, 40*time.Millisecond)
	release, ok := p.enter()
	if !ok {
		t.Fatal("第一个请求应抢到槽")
	}
	start := time.Now()
	if _, ok := p.enter(); ok {
		t.Fatal("满池必须排队后拒绝")
	}
	if waited := time.Since(start); waited < 30*time.Millisecond {
		t.Fatalf("排队窗口未生效（只等了 %s）", waited)
	}
	release()
	if got := len(p.slots); got != 0 {
		t.Fatalf("release 后占用 = %d，want 0", got)
	}
	if release2, ok := p.enter(); !ok {
		t.Fatal("释放后应能再次进入")
	} else {
		release2()
	}
}

// TestRequestPoolQueueAbsorbsBurst 验证瞬时并发会被排队窗口吸收而不是直接 503。
func TestRequestPoolQueueAbsorbsBurst(t *testing.T) {
	p := newRequestPool("t", 1, 200*time.Millisecond)
	release, _ := p.enter()
	go func() {
		time.Sleep(20 * time.Millisecond)
		release()
	}()
	start := time.Now()
	release2, ok := p.enter()
	if !ok {
		t.Fatal("排队窗口内应等到槽，而不是 503")
	}
	if time.Since(start) > 150*time.Millisecond {
		t.Fatal("等槽耗时异常")
	}
	release2()
}

// TestRouteRejectsWithRetryAfter 源码级断言：拒绝时必须带 Retry-After，
// 前端据此退避重试，而不是把 503 当永久失败。
func TestRouteRejectsWithRetryAfter(t *testing.T) {
	raw, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, want := range []string{`a.poolFor(r)`, `"Retry-After"`, `pool.enter()`} {
		if !strings.Contains(source, want) {
			t.Fatalf("main.go 缺少准入装配 %q", want)
		}
	}
	if strings.Contains(source, "make(chan struct{}, 4)") {
		t.Fatal("不要退回「全站 4 槽」的老口径")
	}
}
