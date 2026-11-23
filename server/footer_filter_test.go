package main

import "testing"

// 页脚/汇总行不是交易：必须在抽行阶段剔除，而不是留下变成 invalid 脏行。
// 之前招行等 PDF 每页页脚都被当成一笔交易，导致整份文档从 success 被拖成
// partial/suspect（用户看到"部分交易字段无效"）。
func TestIsPageFooterLine(t *testing.T) {
	footers := []string{
		"打印时间: | 2026-11-17本页支出：CNY:667,408.51 | 16:52:09 | 打印方式:手机银行 | 打印机构:999999999打印柜员:SJGY本页收入：CNY:849,951.21",
		"打印时间：2026-11-17 16:52:09 打印方式：手机银行 打印机构：某某银行",
		"本页支出 CNY:1,000.00 本页收入 CNY:2,000.00",
		"打印柜员:SJGY 打印机构:999999999",
		// 中行末页页脚（单特征即可）
		"温馨提示: 1.记账日期/时间为系统进行记账处理的日期/时间,可能与实际交易提交时间存在差异。",
		"--------------------END--------------------",
		"第 28 页/共 28 页",
	}
	for _, line := range footers {
		if !isPageFooterLine(line) {
			t.Fatalf("应识别为页脚: %q", line)
		}
	}

	transactions := []string{
		"271 | 2026-02-16 | CNY | 42,500.00 | 93,717.56普通汇兑/备用金/绍兴杭才科技有限公司",
		"568 | 2026-05-23 | CNY | -1,000.00 | 5,850.26财付通微信-微信转账",
		"1 | 2026-01-05 | CNY | -2,500.00 | 支付货款给供应商A",
		// 摘要里恰好出现"打印"单个词，不能误杀
		"2 | 2026-01-06 | CNY | 8800.00 | 打印服务费报销",
	}
	for _, line := range transactions {
		if isPageFooterLine(line) {
			t.Fatalf("正常交易被误判为页脚: %q", line)
		}
	}
}

func TestIsPageFooterMarker(t *testing.T) {
	yes := []string{"温馨提示:", "温馨提示", "说明:", "特别说明:盖章无效", "--------------------END--------------------", "第28页"}
	for _, s := range yes {
		if !isPageFooterMarker(s) {
			t.Fatalf("应识别为页脚锚点: %q", s)
		}
	}
	no := []string{"网上快捷支付", "转账支出", "阮坚华", "2025-09-06"}
	for _, s := range no {
		if isPageFooterMarker(s) {
			t.Fatalf("正常词被误判为页脚锚点: %q", s)
		}
	}
}

func TestSanitizeMoneyTokenGluedFooter(t *testing.T) {
	got := sanitizeMoneyToken("-17.091.记账日期/时间为系统进行记账处理的日期/时间,可能与实际交易提交时间存在差异。")
	if got != "-17.09" {
		t.Fatalf("sanitizeMoneyToken = %q, want -17.09", got)
	}
	n, err := cents(got)
	if err != nil || n != -1709 {
		t.Fatalf("cents(%q) = %d, %v; want -1709", got, n, err)
	}
	// 已干净的金额保持不变
	if sanitizeMoneyToken("-7,584.83") != "-7,584.83" {
		t.Fatalf("clean money mutated: %q", sanitizeMoneyToken("-7,584.83"))
	}
}
