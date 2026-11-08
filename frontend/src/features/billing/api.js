import { api } from "@/shared/api/client.js";

export function getSkus() {
  return api("/api/billing/skus");
}

export function getBalance() {
  return api("/api/billing/balance");
}

export function getOrders({ page = 1, pageSize = 10 } = {}) {
  return api(`/api/billing/orders?page=${page}&page_size=${pageSize}`);
}

export function getOrder(orderNo) {
  return api(`/api/billing/orders/${encodeURIComponent(orderNo)}`);
}

export function createOrder(skuCode) {
  return api("/api/billing/orders", { sku_code: skuCode });
}

export function getLedgers({ page = 1, pageSize = 10 } = {}) {
  return api(`/api/billing/ledgers?page=${page}&page_size=${pageSize}`);
}
