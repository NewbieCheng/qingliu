/** 工作台余额：永久桶 + 本期桶。优先读服务端 available_points。 */

export function availablePoints(balance) {
  if (balance == null) return null;
  if (balance.available_points != null && balance.available_points !== "") {
    return Number(balance.available_points) || 0;
  }
  const permanent = Number(balance.points_balance || 0);
  const period = Number(balance.period_points_balance || 0);
  return permanent + period;
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
