package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestEnvDaysFallback(t *testing.T) {
	t.Setenv("COLD_DATA_RETENTION_DAYS", "")
	if got := coldDataRetentionDays(); got != 30 {
		t.Fatalf("cold default = %d", got)
	}
	t.Setenv("AI_ANALYSIS_RETENTION_DAYS", "")
	if got := aiAnalysisRetentionDays(); got != 60 {
		t.Fatalf("ai default = %d", got)
	}
	t.Setenv("TEMP_CACHE_RETENTION_DAYS", "")
	if got := tempCacheRetentionDays(); got != 7 {
		t.Fatalf("temp default = %d", got)
	}
	t.Setenv("AI_ANALYSIS_RETENTION_DAYS", "90")
	if got := aiAnalysisRetentionDays(); got != 90 {
		t.Fatalf("ai override = %d", got)
	}
	t.Setenv("COLD_DATA_RETENTION_DAYS", "0")
	if got := coldDataRetentionDays(); got != 30 {
		t.Fatalf("invalid cold should fallback, got %d", got)
	}
}

func TestPurgeOrphanTempDirs(t *testing.T) {
	root := t.TempDir()
	oldDir := filepath.Join(root, "qingliu-parse-old")
	freshDir := filepath.Join(root, "qingliu-parse-fresh")
	keepDir := filepath.Join(root, "other-keep")
	for _, d := range []string{oldDir, freshDir, keepDir} {
		if err := os.MkdirAll(d, 0700); err != nil {
			t.Fatal(err)
		}
	}
	oldTime := time.Now().Add(-10 * 24 * time.Hour)
	if err := os.Chtimes(oldDir, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	n := purgeOrphanTempDirs(root, cutoff, "qingliu-parse-", "qingliu-page-")
	if n != 1 {
		t.Fatalf("purged = %d, want 1", n)
	}
	if _, err := os.Stat(oldDir); !os.IsNotExist(err) {
		t.Fatal("old dir should be removed")
	}
	if _, err := os.Stat(freshDir); err != nil {
		t.Fatal("fresh dir should remain")
	}
	if _, err := os.Stat(keepDir); err != nil {
		t.Fatal("unrelated dir should remain")
	}
}

func TestPurgePendingFilesKeepsRunningAndFresh(t *testing.T) {
	dir := t.TempDir()
	oldDone := filepath.Join(dir, "job-done")
	oldRunning := filepath.Join(dir, "job-run")
	oldOrphan := filepath.Join(dir, "job-orphan")
	freshDone := filepath.Join(dir, "job-fresh")
	for _, p := range []string{oldDone, oldRunning, oldOrphan, freshDone} {
		if err := os.WriteFile(p, []byte("x"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-10 * 24 * time.Hour)
	for _, p := range []string{oldDone, oldRunning, oldOrphan} {
		if err := os.Chtimes(p, old, old); err != nil {
			t.Fatal(err)
		}
	}
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	status := map[string]string{
		"job-done":  "done",
		"job-run":   "running",
		"job-fresh": "done",
	}
	n := purgePendingFiles(dir, cutoff, func(id string) (string, bool) {
		st, ok := status[id]
		return st, ok
	})
	if n != 2 {
		t.Fatalf("purged=%d want 2 (done+orphan)", n)
	}
	if _, err := os.Stat(oldDone); !os.IsNotExist(err) {
		t.Fatal("old done should be removed")
	}
	if _, err := os.Stat(oldOrphan); !os.IsNotExist(err) {
		t.Fatal("orphan should be removed")
	}
	if _, err := os.Stat(oldRunning); err != nil {
		t.Fatal("running pending must remain")
	}
	if _, err := os.Stat(freshDone); err != nil {
		t.Fatal("fresh pending must remain")
	}
}

func TestPurgePendingNeverTouchesUploadsReports(t *testing.T) {
	root := t.TempDir()
	pending := filepath.Join(root, "pending")
	uploads := filepath.Join(root, "uploads", "c1")
	reports := filepath.Join(root, "reports", "c1")
	for _, d := range []string{pending, uploads, reports} {
		if err := os.MkdirAll(d, 0700); err != nil {
			t.Fatal(err)
		}
	}
	oldPending := filepath.Join(pending, "orphan1")
	uploadFile := filepath.Join(uploads, "doc1")
	reportFile := filepath.Join(reports, "r1.pdf")
	for _, p := range []string{oldPending, uploadFile, reportFile} {
		if err := os.WriteFile(p, []byte("x"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-10 * 24 * time.Hour)
	_ = os.Chtimes(oldPending, old, old)
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	if purgePendingFiles(pending, cutoff, func(string) (string, bool) { return "", false }) != 1 {
		t.Fatal("pending orphan not purged")
	}
	if _, err := os.Stat(uploadFile); err != nil {
		t.Fatal("uploads must remain")
	}
	if _, err := os.Stat(reportFile); err != nil {
		t.Fatal("reports must remain")
	}
}

// TestPurgeColdDataDevDB 对本机 qingliu 开发库：记录红线表行数 → 执行 purge → 红线不变。
// 默认 Skip；QL_ALLOW_DEV_PURGE=1 时启用（用户已授权本地模拟）。
func TestPurgeColdDataDevDB(t *testing.T) {
	if os.Getenv("QL_ALLOW_DEV_PURGE") != "1" {
		t.Skip("set QL_ALLOW_DEV_PURGE=1 to run against local qingliu")
	}
	loadDotEnvForTest(t)
	if os.Getenv("MYSQL_DSN") == "" || os.Getenv("VAULT_KEY") == "" {
		t.Fatal("MYSQL_DSN and VAULT_KEY required")
	}
	s, err := openStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.db.Close() })

	txBefore := countTable(t, s.db, "ql_transactions")
	docBefore := countTable(t, s.db, "ql_documents")
	revBefore := countTable(t, s.db, "ql_reviews")
	repBefore := countTable(t, s.db, "ql_reports")

	jobCutoff := time.Now().UTC().AddDate(0, 0, -coldDataRetentionDays()).Format("2006-01-02 15:04:05")
	aiCutoff := time.Now().UTC().AddDate(0, 0, -aiAnalysisRetentionDays()).Format("2006-01-02 15:04:05")
	var jobCandidates, aiCandidates int64
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM ql_jobs WHERE status IN ('done','failed') AND created<?`, jobCutoff).Scan(&jobCandidates)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM ql_ai_analyses WHERE status IN ('done','failed') AND COALESCE(completed, created)<?`, aiCutoff).Scan(&aiCandidates)
	t.Logf("purge candidates jobs=%d ai=%d (may be 0 on fresh DB)", jobCandidates, aiCandidates)

	_ = s.purgeColdData(time.Now())

	if countTable(t, s.db, "ql_transactions") != txBefore {
		t.Fatal("ql_transactions changed")
	}
	if countTable(t, s.db, "ql_documents") != docBefore {
		t.Fatal("ql_documents changed")
	}
	if countTable(t, s.db, "ql_reviews") != revBefore {
		t.Fatal("ql_reviews changed")
	}
	if countTable(t, s.db, "ql_reports") != repBefore {
		t.Fatal("ql_reports changed")
	}

	// QL2 filesystem against DATA_DIR (and isolated temp root)
	pending := filepath.Join(s.root, "pending")
	_ = os.MkdirAll(pending, 0700)
	marker := "orp" + id()[:12]
	orphan := filepath.Join(pending, marker)
	if err := os.WriteFile(orphan, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	_ = os.Chtimes(orphan, time.Now().Add(-10*24*time.Hour), time.Now().Add(-10*24*time.Hour))
	tmp := t.TempDir()
	oldParse := filepath.Join(tmp, "qingliu-parse-"+marker)
	_ = os.MkdirAll(oldParse, 0700)
	_ = os.Chtimes(oldParse, time.Now().Add(-10*24*time.Hour), time.Now().Add(-10*24*time.Hour))
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	if purgePendingFiles(pending, cutoff, func(jobID string) (string, bool) {
		row := s.one("SELECT status FROM ql_jobs WHERE id=?", jobID)
		if row == nil {
			return "", false
		}
		return str(row, "status"), true
	}) < 1 {
		t.Fatal("pending orphan not purged")
	}
	if purgeOrphanTempDirs(tmp, cutoff, "qingliu-parse-", "qingliu-page-") != 1 {
		t.Fatal("temp parse dir not purged")
	}
}

func loadDotEnvForTest(t *testing.T) {
	t.Helper()
	b, err := os.ReadFile("../.env")
	if err != nil {
		b, err = os.ReadFile(".env")
	}
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		k, v, _ := strings.Cut(line, "=")
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
}

func countTable(t *testing.T, db *sql.DB, table string) int64 {
	t.Helper()
	var n int64
	if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}
