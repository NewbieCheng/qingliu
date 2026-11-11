export const SOURCES = {
  bank_statement: "Bank statement",
  wechat_statement: "WeChat wallet",
  alipay_statement: "Alipay wallet",
  credit_report: "Credit report",
  other: "Auto-detect / other",
};

export const TRANSACTION_LABELS = {
  included: "Tentative business (unverified)",
  excluded: "Excluded",
  pending: "Needs review",
  expense: "Expense ledger",
  invalid: "Parse failed",
  neutral: "Neutral (no P/L)",
  duplicate: "Possible duplicate",
};

export const ROLES = {
  admin: "Admin",
  sales: "Sales",
  reviewer: "Reviewer",
  // 工作台 `enterprise_member_readonly` 等只读档位会落到这里（见 server/permissions.go）。
  // 改造前它们被降级成 sales，界面还写着「业务员」，与实际权限不符。
  readonly: "Read-only member",
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
  success: "Recognized",
  partial: "Partial / needs check",
  failed: "Incomplete recognition",
};

export const JOB_STATUS = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  partial: "Needs check",
  failed: "Failed",
};
