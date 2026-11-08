export const SOURCES = {
  bank_statement: "银行卡流水",
  wechat_statement: "微信钱包",
  alipay_statement: "支付宝钱包",
  credit_report: "个人征信",
  other: "自动识别 / 其他",
};

export const TRANSACTION_LABELS = {
  included: "暂计经营（未核实）",
  excluded: "明确剔除",
  pending: "待复核",
  expense: "支出台账",
  invalid: "解析失败",
  neutral: "不计收支",
  duplicate: "疑似重复待确认",
};

export const ROLES = {
  admin: "管理员",
  sales: "业务员",
  reviewer: "复核员",
};

export const DOCUMENT_STATUS = {
  success: "识别完成",
  partial: "部分可用 / 待核对",
  failed: "未完整识别",
};

export const JOB_STATUS = {
  queued: "排队中",
  running: "处理中",
  done: "已完成",
  partial: "待核对",
  failed: "失败",
};
