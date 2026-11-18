import { ORDER_STATUS } from "../constants.js";

export function remainingMs(order) {
  if (!order?.expires_at) return 0;
  return Math.max(0, new Date(order.expires_at).getTime() - Date.now());
}

export function remainingText(order) {
  const total = Math.ceil(remainingMs(order) / 1000);
  const minutes = Math.max(0, Math.floor(total / 60));
  const seconds = Math.max(0, total % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** 返回订单状态 i18n key；调用方用 t(...) 展示。 */
export function orderStatusLabel(order) {
  if (
    order?.status === "closed" &&
    order.expires_at &&
    new Date(order.expires_at).getTime() <= Date.now()
  ) {
    return "billing.order_status.expired";
  }
  return ORDER_STATUS[order?.status] || "";
}

export function isExpired(order) {
  return Boolean(
    order?.status === "pending" &&
      order.expires_at &&
      new Date(order.expires_at).getTime() <= Date.now(),
  );
}

export function isResumable(order) {
  return Boolean(
    order?.status === "pending" &&
      order.code_url &&
      !order.code_url.startsWith("mock://") &&
      remainingMs(order) > 0,
  );
}
