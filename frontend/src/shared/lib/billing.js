// 计费解析入口（上传解析 / AI 解析 / 文档 OCR）在积分不足时统一返回 402，
// 由页面据此拉起「前往充值」的提示，而不是让用户对着服务端文案猜下一步。
export const INSUFFICIENT_POINTS_STATUS = 402;

export function isInsufficientPointsError(error) {
  if (!error) return false;
  return Number(error.status) === INSUFFICIENT_POINTS_STATUS;
}

/**
 * 工作台积分的读法与展示口径。
 *
 * 余额有两个桶：永久桶（points_balance，不过期）与本期桶
 * （period_points_balance，订阅套餐发的，到 period_expires_at 作废）。
 * 「可用积分」是两个桶之和；扣费在工作台侧先扣本期再扣永久，这里只负责展示。
 *
 * 放在 shared/lib 而不是 features/billing/lib，是因为顶栏（shared/layout）
 * 也要显示可用积分，而 shared 不允许依赖 features。
 */

export function availablePoints(balance) {
  if (balance == null) return null;
  if (balance.available_points != null && balance.available_points !== "") {
    return Number(balance.available_points) || 0;
  }
  return Number(balance.points_balance || 0) + Number(balance.period_points_balance || 0);
}

export function permanentPoints(balance) {
  return Number(balance?.points_balance || 0);
}

export function periodPoints(balance) {
  return Number(balance?.period_points_balance || 0);
}

export function periodExpiresAt(balance) {
  const raw = balance?.period_expires_at;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
