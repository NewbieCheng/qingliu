export const ORDER_STATUS = {
  pending: "待支付",
  paid: "已支付",
  closed: "已关闭",
  failed: "失败",
};

export const LEDGER_CHANGE = {
  1: "注册赠送",
  2: "套餐发放",
  3: "AI 消耗",
  4: "人工调整",
  5: "预授权退回",
  6: "充值到账",
  7: "临时积分到期作废",
};

/** 按 change_type + period_points_delta 给业务员看清「临时 / 永久」。 */
export function ledgerChangeLabel(ledger) {
  const type = Number(ledger?.change_type);
  if (type === 7) return LEDGER_CHANGE[7];
  const periodDelta = Number(ledger?.period_points_delta || 0);
  if (type === 6) {
    if (periodDelta > 0) return "订阅到账（临时）";
    if (periodDelta < 0) return "临时积分变动";
    return "充值到账（永久）";
  }
  if (type === 3 && periodDelta < 0) return "AI 消耗（含临时）";
  return LEDGER_CHANGE[type] || ledger?.change_type || "—";
}
