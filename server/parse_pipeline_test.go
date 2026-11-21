package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// 用真实申报表验证：归类为 form、41 栏次抽取、勾稽 verdict。
func TestPipelineFormClassification(t *testing.T) {
	path := filepath.Join("..", "recovered", "增值税申报表_2026-10.pdf")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("no recovered fixture: %v", err)
	}
	ctx := context.Background()
	// AI 不可用时（app=nil）必须靠兜底正确归类为 form，而不是误判流水。
	kind, source, _, _ := (&App{}).classifyDocument(ctx, "", path, "other", raw)
	if kind != DocForm {
		t.Fatalf("classify = %s, want form (误判为流水则回归)", kind)
	}
	if source != "vat_return" {
		t.Fatalf("source = %s, want vat_return", source)
	}

	out, err := (&App{}).parseDocument(ctx, "", Object{"name": path, "source": "other"}, raw, nil)
	if err != nil {
		t.Fatalf("parseDocument: %v", err)
	}
	if out.DocType != DocForm {
		t.Fatalf("doc_type = %s, want form", out.DocType)
	}
	if str(out.Result.Meta, "method") != "form-template" {
		t.Fatalf("method = %s, want form-template", str(out.Result.Meta, "method"))
	}
	lines := list(out.Result.Meta["form_lines"])
	if len(lines) < 30 {
		t.Fatalf("抽取栏次数 = %d, want >=30", len(lines))
	}
	if len(out.Result.Rows) != 0 {
		t.Fatalf("表单不应产生交易行，got %d", len(out.Result.Rows))
	}
	header, _ := out.Result.Meta["form_header"].(map[string]any)
	if str(header, "纳税人识别号") == "" {
		t.Errorf("表头未抽到纳税人识别号: %v", header)
	}
	t.Logf("OK kind=%s lines=%d verdict=%s checks=%d", out.DocType, len(lines), out.Verdict, len(out.Checks))
}

func TestDetectSourceFallbackVAT(t *testing.T) {
	text := "增值税及附加税费申报表 一般纳税人适用 开户银行 某某银行 栏次 本月数 本年累计"
	kind, source := detectSourceFromText(text, "other")
	if kind != DocForm || source != "vat_return" {
		t.Fatalf("got %s/%s, want form/vat_return（银行二字不应导致误判）", kind, source)
	}
}

func TestVerdictFusionNeverUpgrades(t *testing.T) {
	if got := worseVerdict(VerdictSuspect, VerdictOK); got != VerdictSuspect {
		t.Fatalf("suspect+ok = %s, want suspect", got)
	}
	if got := worseVerdict(VerdictOK, VerdictFail); got != VerdictFail {
		t.Fatalf("ok+fail = %s, want fail", got)
	}
}
