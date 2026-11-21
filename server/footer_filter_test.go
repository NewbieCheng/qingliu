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
