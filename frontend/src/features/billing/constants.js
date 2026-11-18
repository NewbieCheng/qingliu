/** 订单状态 → i18n key（展示时用 t(ORDER_STATUS[status])） */
export const ORDER_STATUS = {
  pending: "billing.order_status.pending",
  paid: "billing.order_status.paid",
  closed: "billing.order_status.closed",
  failed: "billing.order_status.failed",
};

/** 积分流水变动类型 → i18n key */
export const LEDGER_CHANGE = {
  1: "billing.ledger_change.1",
  2: "billing.ledger_change.2",
  3: "billing.ledger_change.3",
  4: "billing.ledger_change.4",
  5: "billing.ledger_change.5",
  6: "billing.ledger_change.6",
  7: "billing.ledger_change.7",
};

/**
 * 按 change_type + period_points_delta 返回 i18n key。
 * 调用方用 t(...) 展示，禁止再写中/英硬编码。
 */
export function ledgerChangeLabel(ledger) {
  const type = Number(ledger?.change_type);
  if (type === 7) return LEDGER_CHANGE[7];
  const periodDelta = Number(ledger?.period_points_delta || 0);
  if (type === 6) {
    if (periodDelta > 0) return "billing.ledger_change.6_temp";
    if (periodDelta < 0) return "billing.ledger_change.6_temp_adjust";
    return "billing.ledger_change.6_perm";
  }
  if (type === 3 && periodDelta < 0) return "billing.ledger_change.3_with_temp";
  return LEDGER_CHANGE[type] || "";
}
