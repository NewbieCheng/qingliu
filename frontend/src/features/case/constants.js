export const CASE_STEPS = [
  ["upload", "Upload files"],
  ["ownership", "Confirm ownership"],
  ["review", "核对疑点"],
  ["report", "查看报告"],
];

export const CASE_VIEWS = {
  issues: "待处理疑点",
  all: "全部交易",
  confirmed: "已人工确认",
  duplicate: "疑似重复",
};

export const REVIEW_OPTIONS = [
  ["included", "收入：暂计经营"],
  ["excluded", "收入：明确剔除"],
  ["pending", "收入：待核实"],
  ["duplicate", "确认重复"],
  ["expense", "重复支出：确认独立支出"],
  ["neutral", "重复其他：确认独立记录"],
  ["undo", "撤销上一条确认"],
];
