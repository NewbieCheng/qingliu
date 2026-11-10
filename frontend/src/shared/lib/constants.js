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
  // 工作台 `enterprise_member_readonly` 等只读档位会落到这里（见 server/permissions.go）。
  // 改造前它们被降级成 sales，界面还写着「业务员」，与实际权限不符。
  readonly: "只读成员",
};

/** 团队与权限 / 成员管理：只认工作台投影的 qingliu.admin（role 仅兜底）。 */
export function isQingliuAdmin(user) {
  if (!user) return false;
  const permissions = user.permissions;
  if (Array.isArray(permissions) && permissions.includes("qingliu.admin")) {
    return true;
  }
  if (permissions && typeof permissions === "object" && !Array.isArray(permissions)) {
    return Boolean(permissions["qingliu.admin"]);
  }
  return user.role === "admin";
}

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
