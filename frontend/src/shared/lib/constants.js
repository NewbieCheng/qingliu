/** 资料来源码 → i18n key（展示时用 t(SOURCES[code])） */
export const SOURCES = {
  bank_statement: "source.bank_statement",
  wechat_statement: "source.wechat_statement",
  alipay_statement: "source.alipay_statement",
  credit_report: "source.credit_report",
  other: "source.other",
};

/** 核对标签 → i18n key */
export const TRANSACTION_LABELS = {
  included: "label.included",
  excluded: "label.excluded",
  pending: "label.pending",
  expense: "label.expense",
  invalid: "label.invalid",
  neutral: "label.neutral",
  duplicate: "label.duplicate",
};

export const ROLES = {
  admin: "role.admin",
  sales: "role.sales",
  reviewer: "role.reviewer",
  // 工作台 `enterprise_member_readonly` 等只读档位会落到这里（见 server/permissions.go）。
  // 改造前它们被降级成 sales，界面还写着「业务员」，与实际权限不符。
  readonly: "role.readonly",
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

/** 文档识别状态 → i18n key */
export const DOCUMENT_STATUS = {
  success: "doc.success",
  partial: "doc.partial",
  failed: "doc.failed",
};

/** 后台任务状态 → i18n key */
export const JOB_STATUS = {
  queued: "job.queued",
  running: "job.running",
  done: "job.done",
  partial: "job.partial",
  failed: "job.failed",
};
