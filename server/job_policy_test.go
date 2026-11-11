package main

import (
	"strings"
	"testing"
	"time"
)

func TestJobPolicyByKind(t *testing.T) {
	upload := jobPolicy("upload")
	ai := jobPolicy("ai_analysis")
	if upload.StaleMinutes >= ai.StaleMinutes {
		t.Fatalf("ai_analysis stale should exceed upload: upload=%d ai=%d", upload.StaleMinutes, ai.StaleMinutes)
	}
	if upload.RunTimeout < 10*time.Minute {
		t.Fatalf("upload run timeout too short: %s", upload.RunTimeout)
	}
	if !upload.LocksBusy || ai.LocksBusy {
		t.Fatalf("busy lock flags wrong: upload=%v ai=%v", upload.LocksBusy, ai.LocksBusy)
	}
	unknown := jobPolicy("weird")
	if unknown.StaleMinutes <= 0 || unknown.RunTimeout <= 0 {
		t.Fatalf("unknown policy invalid: %+v", unknown)
	}
}

func TestJobStaleSQLInterval(t *testing.T) {
	sql := jobStaleSQLInterval()
	for _, kind := range []string{"upload", "report", "ai_analysis"} {
		if !strings.Contains(sql, kind) {
			t.Fatalf("stale SQL missing %s: %s", kind, sql)
		}
	}
	if maxJobStaleMinutes() < jobPolicy("ai_analysis").StaleMinutes {
		t.Fatalf("max stale smaller than ai policy")
	}
}
