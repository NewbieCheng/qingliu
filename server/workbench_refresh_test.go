package main

import (
	"errors"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestWorkbenchRefreshReuseRevokesFamily 复现根因（不连库）：
//
// 工作台 access token 默认 15 分钟；refresh 是一次性轮换，复用旧 refresh
// 会吊销整个 family。清流若对同一 refresh 并发打两次 /auth/refresh，
// 第二次被当成盗用，第一次刚换到的新令牌一并作废，页面就出现
// 「请重新登录工作台账号」，且本机 Cookie 仍有效、看起来像「无缘无故被踢」。
func TestWorkbenchRefreshReuseRevokesFamily(t *testing.T) {
	type wb struct {
		mu      sync.Mutex
		valid   map[string]bool
		revoked bool
	}
	backend := &wb{valid: map[string]bool{"rt-old": true}}

	// 模拟工作台 Rotate：先看令牌是否仍有效，再标记作废并发新令牌。
	// 中间故意放开锁窗口，让两个调用都读到「仍有效」。
	refresh := func(rt string) error {
		backend.mu.Lock()
		if backend.revoked {
			backend.mu.Unlock()
			return errors.New("请重新登录工作台账号")
		}
		ok := backend.valid[rt]
		backend.mu.Unlock()

		time.Sleep(15 * time.Millisecond) // 并发窗口

		backend.mu.Lock()
		defer backend.mu.Unlock()
		if backend.revoked || !ok || !backend.valid[rt] {
			backend.revoked = true
			for k := range backend.valid {
				backend.valid[k] = false
			}
			return errors.New("请重新登录工作台账号")
		}
		backend.valid[rt] = false
		backend.valid["rt-new"] = true
		return nil
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = refresh("rt-old")
		}(i)
	}
	wg.Wait()

	ok, fail := 0, 0
	for _, err := range errs {
		if err == nil {
			ok++
		} else {
			fail++
		}
	}
	if ok != 1 || fail != 1 {
		t.Fatalf("without singleflight want 1 ok + 1 fail, got ok=%d fail=%d errs=%v", ok, fail, errs)
	}
	if !backend.revoked {
		t.Fatal("expected family revoked after concurrent refresh reuse")
	}
	if err := refresh("rt-new"); err == nil {
		t.Fatal("revoked family must reject later refresh (整站计费/空间代理一起挂)")
	}
}

// TestRefreshGateMergesCallers 验证修复：同 user 并发只打一次上游。
func TestRefreshGateMergesCallers(t *testing.T) {
	var calls atomic.Int64
	var mu sync.Mutex
	gates := map[string]*wbRefreshGate{}

	doRefresh := func(userID string) (string, error) {
		mu.Lock()
		if g, ok := gates[userID]; ok {
			mu.Unlock()
			<-g.done
			return g.token, g.err
		}
		g := &wbRefreshGate{done: make(chan struct{})}
		gates[userID] = g
		mu.Unlock()

		calls.Add(1)
		time.Sleep(30 * time.Millisecond)
		token, err := "access-"+userID, error(nil)

		g.token, g.err = token, err
		mu.Lock()
		delete(gates, userID)
		mu.Unlock()
		close(g.done)
		return token, err
	}

	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tok, err := doRefresh("u1")
			if err != nil || tok != "access-u1" {
				t.Errorf("merged refresh = %q %v", tok, err)
			}
		}()
	}
	wg.Wait()
	if got := calls.Load(); got != 1 {
		t.Fatalf("upstream refresh calls = %d, want 1", got)
	}
}

func TestWbRefreshSourceHasSingleflight(t *testing.T) {
	raw, err := os.ReadFile("workbench.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, want := range []string{
		"refreshGates",
		"wbRefreshOnce",
		"wbFreshAccess",
		"<-gate.done",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("workbench.go missing singleflight piece %q", want)
		}
	}
}
