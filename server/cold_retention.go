package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// coldDataRetentionDays 中间态冷数据保留天数（ql_jobs / ql_upload_batches）。
// 环境变量 COLD_DATA_RETENTION_DAYS，缺省 30。权威流水/核对/原件/报告不在此清理。
func coldDataRetentionDays() int {
	return envDays("COLD_DATA_RETENTION_DAYS", 30)
}

// aiAnalysisRetentionDays ql_ai_analyses 终态保留天数，缺省 60（可被 AI_ANALYSIS_RETENTION_DAYS 覆盖）。
func aiAnalysisRetentionDays() int {
	return envDays("AI_ANALYSIS_RETENTION_DAYS", 60)
}

// tempCacheRetentionDays DATA_DIR/pending 与 OS 临时切页目录保留天数，缺省 7。
func tempCacheRetentionDays() int {
	return envDays("TEMP_CACHE_RETENTION_DAYS", 7)
}

func envDays(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return fallback
	}
	return n
}

// purgeColdData 只删已终态的任务/上传批次/AI 分析中间态。
// 永不碰 ql_transactions / ql_reviews / ql_documents / ql_reports。
// 不经 poolFor：由后台 ticker 直接调 Store，避免占 HTTP 分池槽。
func (s *Store) purgeColdData(now time.Time) int64 {
	jobCutoff := now.UTC().AddDate(0, 0, -coldDataRetentionDays()).Format("2006-01-02 15:04:05")
	aiCutoff := now.UTC().AddDate(0, 0, -aiAnalysisRetentionDays()).Format("2006-01-02 15:04:05")

	var total int64
	res, err := s.db.Exec(
		"DELETE FROM ql_jobs WHERE status IN ('done','failed') AND created<?",
		jobCutoff,
	)
	if err != nil {
		panic(err)
	}
	n, _ := res.RowsAffected()
	total += n

	res, err = s.db.Exec("DELETE FROM ql_upload_batches WHERE created<?", jobCutoff)
	if err != nil {
		panic(err)
	}
	n, _ = res.RowsAffected()
	total += n

	res, err = s.db.Exec(
		"DELETE FROM ql_ai_analyses WHERE status IN ('done','failed') AND COALESCE(completed, created)<?",
		aiCutoff,
	)
	if err != nil {
		panic(err)
	}
	n, _ = res.RowsAffected()
	total += n
	return total
}

// purgeTempCaches 清理 DATA_DIR/pending 孤儿文件，以及 OS 临时目录里崩溃残留的
// qingliu-parse-* / qingliu-page-* 目录（正常路径 defer RemoveAll；这里兜底超期残留）。
// 永不碰 uploads/ / reports/（原件与报告红线）。
func (s *Store) purgeTempCaches(now time.Time) int64 {
	cutoff := now.UTC().AddDate(0, 0, -tempCacheRetentionDays())
	var total int64
	total += purgePendingFiles(filepath.Join(s.root, "pending"), cutoff, func(jobID string) (string, bool) {
		row := s.one("SELECT status FROM ql_jobs WHERE id=?", jobID)
		if row == nil {
			return "", false
		}
		return str(row, "status"), true
	})
	total += purgeOrphanTempDirs(os.TempDir(), cutoff, "qingliu-parse-", "qingliu-page-")
	return total
}

// purgePendingFiles 删除超期 pending 文件：job 已终态，或库中已无该 job（孤儿）。
// running/queued 的 pending 一律保留。jobStatus 返回 (status, exists)。
func purgePendingFiles(pendingDir string, cutoff time.Time, jobStatus func(jobID string) (string, bool)) int64 {
	entries, err := os.ReadDir(pendingDir)
	if err != nil {
		return 0
	}
	var total int64
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		path := filepath.Join(pendingDir, ent.Name())
		info, err := ent.Info()
		if err != nil {
			continue
		}
		if info.ModTime().UTC().After(cutoff) {
			continue
		}
		if jobStatus != nil {
			st, exists := jobStatus(ent.Name())
			if exists && st != "done" && st != "failed" {
				continue
			}
		}
		if err := os.Remove(path); err == nil {
			total++
		}
	}
	return total
}

func purgeOrphanTempDirs(tempRoot string, cutoff time.Time, prefixes ...string) int64 {
	entries, err := os.ReadDir(tempRoot)
	if err != nil {
		return 0
	}
	var total int64
	for _, ent := range entries {
		if !ent.IsDir() {
			continue
		}
		name := ent.Name()
		match := false
		for _, p := range prefixes {
			if strings.HasPrefix(name, p) {
				match = true
				break
			}
		}
		if !match {
			continue
		}
		info, err := ent.Info()
		if err != nil || info.ModTime().UTC().After(cutoff) {
			continue
		}
		path := filepath.Join(tempRoot, name)
		if err := os.RemoveAll(path); err == nil {
			total++
		}
	}
	return total
}

// startColdDataRetention 启动时先清一轮，之后每小时再清。ctx 取消即停。
// 约束：只走后台 ticker，禁止挂到会经 poolFor 的管理 HTTP。
func startColdDataRetention(ctx context.Context, s *Store) {
	run := func() {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("cold data purge failed: %v", rec)
			}
		}()
		now := time.Now()
		if n := s.purgeColdData(now); n > 0 {
			log.Printf("cold data purged %d rows (jobs/batches=%dd ai=%dd)",
				n, coldDataRetentionDays(), aiAnalysisRetentionDays())
		}
		if n := s.purgeTempCaches(now); n > 0 {
			log.Printf("temp cache purged %d entries (retention=%dd)", n, tempCacheRetentionDays())
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
