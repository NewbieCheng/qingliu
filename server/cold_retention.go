package main

import (
	"context"
	"log"
	"os"
	"strconv"
	"time"
)

// coldDataRetentionDays 中间态冷数据保留天数。权威流水/核对/原件/报告不在此清理。
// 环境变量 COLD_DATA_RETENTION_DAYS，缺省 30。
func coldDataRetentionDays() int {
	raw := os.Getenv("COLD_DATA_RETENTION_DAYS")
	if raw == "" {
		return 30
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 30
	}
	return n
}

// purgeColdData 只删已终态的任务/上传批次/AI 分析中间态。
// 永不碰 ql_transactions / ql_reviews / ql_documents / ql_reports。
func (s *Store) purgeColdData(now time.Time) int64 {
	days := coldDataRetentionDays()
	cutoff := now.UTC().AddDate(0, 0, -days).Format("2006-01-02 15:04:05")

	var total int64
	res, err := s.db.Exec(
		"DELETE FROM ql_jobs WHERE status IN ('done','failed') AND created<?",
		cutoff,
	)
	if err != nil {
		panic(err)
	}
	n, _ := res.RowsAffected()
	total += n

	res, err = s.db.Exec("DELETE FROM ql_upload_batches WHERE created<?", cutoff)
	if err != nil {
		panic(err)
	}
	n, _ = res.RowsAffected()
	total += n

	res, err = s.db.Exec(
		"DELETE FROM ql_ai_analyses WHERE status IN ('done','failed') AND COALESCE(completed, created)<?",
		cutoff,
	)
	if err != nil {
		panic(err)
	}
	n, _ = res.RowsAffected()
	total += n
	return total
}

// startColdDataRetention 启动时先清一轮，之后每小时再清。ctx 取消即停。
func startColdDataRetention(ctx context.Context, s *Store) {
	run := func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("cold data purge failed: %v", rec)
			}
		}()
		if n := s.purgeColdData(time.Now()); n > 0 {
			log.Printf("cold data purged %d rows (retention=%dd)", n, coldDataRetentionDays())
		}
	}
	run()
	ticker := time.NewTicker(time.Hour)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}
