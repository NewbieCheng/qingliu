import { api } from "@/shared/api/client.js";

export function getEmbedRechargeUrl() {
  return api("/api/billing/embed-url");
}

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

export function createOrder(skuCode, { ownerType = 1, ownerId = 0 } = {}) {
  const body = { sku_code: skuCode };
  if (ownerType) body.owner_type = ownerType;
  if (ownerType === 2 && ownerId > 0) body.owner_id = ownerId;
  return api("/api/billing/orders", body);
}

export function getLedgers({ page = 1, pageSize = 10 } = {}) {
  return api(`/api/billing/ledgers?page=${page}&page_size=${pageSize}`);
}
