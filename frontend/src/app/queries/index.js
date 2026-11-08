import { cacheQuery, dropCache } from "@/shared/api/cache.js";
import { listClients } from "@/features/clients/api.js";
import { getAdminOverview, listAuditEvents } from "@/features/admin/api.js";
import { getBalance } from "@/features/billing/api.js";
import { getProfile } from "@/features/profile/api.js";

const TTL = {
  me: 60_000,
  balance: 10_000,
  clients: 10_000,
  adminUsers: 15_000,
  audit: 15_000,
};

export function queryClients({ query, page, force = false }) {
  return cacheQuery(() => listClients({ query, page }), {
    key: `clients:${query}:${page}`,
    ttlMs: TTL.clients,
    force,
  });
}

export function queryAdminOverview({ force = false } = {}) {
  return cacheQuery(getAdminOverview, {
    key: "admin:overview",
    ttlMs: TTL.adminUsers,
    force,
  });
}

export function queryAuditEvents(params, { force = false } = {}) {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== "" && value != null),
  ).toString();
  return cacheQuery(() => listAuditEvents(search), {
    key: `admin:audit:${search}`,
    ttlMs: TTL.audit,
    force,
  });
}

export function queryProfile({ force = false } = {}) {
  return cacheQuery(getProfile, { key: "profile:me", ttlMs: TTL.me, force });
}

export function queryBalance({ force = false } = {}) {
  return cacheQuery(getBalance, { key: "billing:balance", ttlMs: TTL.balance, force });
}

export function invalidateClients() {
  dropCache("clients:");
}

export function invalidateAdmin() {
  dropCache("admin:");
}

export function invalidateBalance() {
  dropCache("billing:balance");
}

export function invalidateProfile() {
  dropCache("profile:me");
}
