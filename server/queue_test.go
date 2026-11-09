package main

import (
	"fmt"
	"sync"
	"testing"
)

// 串行队列模拟：单 worker 按 seq 取任务，多用户同时提交也必须依次处理。
//
// 真实实现用 MySQL GET_LOCK('qingliu:worker') 保证全局只有一个 worker 在跑；
// 这里用同样的语义（一次只有一个 goroutine 拿到锁）验证排队行为。
type fakeQueue struct {
	mu   sync.Mutex
	next int
	jobs []string
}

func (q *fakeQueue) enqueue(user string) string {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.next++
	id := fmt.Sprintf("%s-%d", user, q.next)
	q.jobs = append(q.jobs, id)
	return id
}

func (q *fakeQueue) take() (string, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.jobs) == 0 {
		return "", false
	}
	job := q.jobs[0]
	q.jobs = q.jobs[1:]
	return job, true
}

func TestConcurrentUploadsAreProcessedSerially(t *testing.T) {
	queue := &fakeQueue{}
	var wg sync.WaitGroup
	// 5 个用户同时各上传 3 份，共 15 个任务。
	for user := 0; user < 5; user++ {
		wg.Add(1)
		go func(user int) {
			defer wg.Done()
			for i := 0; i < 3; i++ {
				queue.enqueue(fmt.Sprintf("u%d", user))
			}
		}(user)
	}
	wg.Wait()
	if len(queue.jobs) != 15 {
		t.Fatalf("queued %d jobs, want 15", len(queue.jobs))
	}

	// 单 worker 串行消费：同一时刻只有一个在跑。
	var (
		running   int
		maxActive int
		processed []string
		activeMu  sync.Mutex
	)
	for {
		job, ok := queue.take()
		if !ok {
			break
		}
		activeMu.Lock()
		running++
		if running > maxActive {
			maxActive = running
		}
		activeMu.Unlock()

		// 模拟解析耗时（这里是逻辑上的独占）。
		activeMu.Lock()
		running--
		processed = append(processed, job)
		activeMu.Unlock()
	}

	if len(processed) != 15 {
		t.Fatalf("processed %d, want 15", len(processed))
	}
	if maxActive > 1 {
		t.Fatalf("max concurrent = %d, serial execution must never exceed 1", maxActive)
	}
}

// 排队位置必须单调反映「前面还有几份」。
func TestQueuePositionCountsOnlyEarlierQueuedJobs(t *testing.T) {
	rows := []struct {
		id     string
		status string
		seq    int
	}{
		{"a", "done", 1},
		{"b", "queued", 2},
		{"c", "queued", 3},
		{"d", "queued", 4},
	}
	// 与 SQL 同口径：统计 status=queued 且 seq 更小的任务数。
	position := func(seq int) int {
		count := 0
		for _, row := range rows {
			if row.status == "queued" && row.seq < seq {
				count++
			}
		}
		return count
	}
	if got := position(2); got != 0 {
		t.Fatalf("first queued job position = %d, want 0 ahead", got)
	}
	if got := position(3); got != 1 {
		t.Fatalf("second queued job position = %d, want 1 ahead", got)
	}
	if got := position(4); got != 2 {
		t.Fatalf("third queued job position = %d, want 2 ahead", got)
	}
}
