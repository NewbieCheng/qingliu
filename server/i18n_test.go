package main

import (
	"net/http/httptest"
	"testing"
)

func TestLocaleFromRequestPrefersXLocale(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Accept-Language", "en-US,en;q=0.9")
	r.Header.Set("X-Locale", "zh-CN")
	if got := localeFromRequest(r); got != localeZH {
		t.Fatalf("localeFromRequest() = %q, want %q", got, localeZH)
	}
}

func TestLocalizeStoredMessageSupportsEnglishJobText(t *testing.T) {
	got := localizeStoredMessage(localeZH, "Queued for parsing")
	want := T(localeZH, "job.upload.queued", nil)
	if got != want {
		t.Fatalf("localizeStoredMessage() = %q, want %q", got, want)
	}
}

func TestLocalizeStoredMessageUploadDoneIsShortChinese(t *testing.T) {
	got := localizeStoredMessage(localeZH, "Recognition complete. Confirm document ownership.")
	if got != "已完成" {
		t.Fatalf("localizeStoredMessage() = %q, want %q", got, "已完成")
	}
	got = localizeStoredMessage(localeZH, "job.upload.done")
	if got != "已完成" {
		t.Fatalf("localizeStoredMessage(key) = %q, want %q", got, "已完成")
	}
}

func TestLocalizeStoredMessageSupportsChineseForEnglish(t *testing.T) {
	got := localizeStoredMessage(localeEN, "请先登录")
	want := T(localeEN, "err.login_required", nil)
	if got != want {
		t.Fatalf("localizeStoredMessage() = %q, want %q", got, want)
	}
}
