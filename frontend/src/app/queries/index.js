import { cacheQuery, dropCache } from "@/shared/api/cache.js";
import { listClients } from "@/features/clients/api.js";
import { getAdminOverview, listAuditEvents } from "@/features/admin/api.js";
import { getBalance } from "@/features/billing/api.js";
import { getCase } from "@/features/case/api.js";
import { getProfile, listSpaces } from "@/features/profile/api.js";

const TTL = {
  me: 60_000,
  balance: 10_000,
  clients: 10_000,
  adminUsers: 15_000,
  audit: 15_000,
  // 底稿页短去重：翻页/筛选连点不重复打；busy 轮询与写后走 force
  case: 8_000,
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

/**
 * 可切换的空间列表。缓存很短：成员关系被工作台改动后，
 * 这里最多 15 秒就会刷新出来。
 */
export function querySpaces({ force = false } = {}) {
  return cacheQuery(listSpaces, { key: "profile:spaces", ttlMs: TTL.adminUsers, force });
}

/**
 * 底稿详情：内存短 TTL 去重。权威仍在服务端；IndexedDB 只缓存原件页 PNG。
 */
export function queryCase(
  cid,
  { range, view, query, page, signal, force = false } = {},
) {
  const rangeKey = typeof range === "string" ? range : new URLSearchParams(range || {}).toString();
  return cacheQuery(
    () => getCase(cid, { range: rangeKey, view, query, page, signal }),
    {
      key: `case:${cid}:${rangeKey}:${view}:${query}:${page}`,
      ttlMs: TTL.case,
      force,
    },
  );
}

export function invalidateClients() {
  dropCache("clients:");
}

export function invalidateCase(cid) {
  dropCache(cid ? `case:${cid}:` : "case:");
}

export function invalidateAdmin() {
  dropCache("admin:");
}

export function invalidateBalance() {
  dropCache("billing:balance");
}

export function invalidateProfile() {
  dropCache("profile:me");
  dropCache("profile:spaces");
}

/**
 * 切换空间后必须清空**全部**业务缓存。
 *
 * 空间换了，客户列表、余额、操作记录、团队与个人资料都换了视角；
 * 只清 profile 会让首页继续显示上一个空间的客户 —— 那是比报错更糟的越权感。
 */
export function invalidateAll() {
  dropCache("");
}
