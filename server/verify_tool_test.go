package main

import (
	"context"
	"fmt"
	"os"
	"testing"
)

// TestVerifyRealStatements 用真实账单跑一遍解析器，输出页数、路径与实际耗时。
// 默认跳过；设置 QL_VERIFY_PDF 指向 PDF 才运行。它不写库、不扣费。
func TestVerifyRealStatements(t *testing.T) {
	path := os.Getenv("QL_VERIFY_PDF")
	if path == "" {
		t.Skip("QL_VERIFY_PDF not set")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	source := os.Getenv("QL_VERIFY_SOURCE")
	if source == "" {
		source = "other"
	}
	ctx := context.Background()
	result, parseErr := parseFile(ctx, raw, path, source, false, func(page, total int) {
		if page == 1 || page == total || page%20 == 0 {
			t.Logf("progress %d/%d (%d%%)", page, total, parsePercent(page, total))
		}
	})
	if parseErr != nil {
		t.Fatalf("parse: %v", parseErr)
	}
	pages := integer(result.Meta["pages"])
	t.Logf("pages=%d rows=%d status=%s method=%s text_pages=%d ocr_pages=%d vision_pages=%d",
		pages, len(result.Rows), str(result.Meta, "status"), str(result.Meta, "method"),
		integer(result.Meta["text_pages"]), integer(result.Meta["ocr_pages"]), integer(result.Meta["vision_pages"]))
	t.Logf("tier=%s cost=%d pages", parseBillingTier(result), pages)
	// 有文字层的账单必须走 text-layer，不允许落到需要模型兜底。
	if str(result.Meta, "method") == "needs-vision" {
		t.Errorf("statement with a text layer must not need vision: %v", result.Meta["issues"])
	}
	fmt.Printf("VERIFY %s pages=%d rows=%d method=%s\n", path, pages, len(result.Rows), str(result.Meta, "method"))
}
