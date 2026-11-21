import { api } from "@/shared/api/client.js";
import { cacheQuery, dropCache } from "@/shared/api/cache.js";
import { TTL, PERSIST, KEY, casePrefix } from "@/shared/cache/policy.js";

// 客户列表：新建/删除不频繁，5 分钟 TTL；写操作后主动失效，
// 避免"刚建完客户列表里看不到"。
export function listClients({ query = "", page = 1, signal, force } = {}) {
  const search = new URLSearchParams({ q: query, page: String(page) });
  const path = `/api/clients?${search}`;
  return cacheQuery(() => api(path, undefined, { signal }), {
    key: KEY.clientList(`${query}|${page}`),
    ttlMs: TTL.clientList,
    persist: PERSIST.clientList,
    force,
  });
}

export function createClient(payload) {
  return api("/api/clients", payload).then((res) => {
    dropCache("clients:");
    return res;
  });
}

/** 删除客户档案：后端会连库里的关联数据与磁盘原件一起清理。 */
export function deleteClient(clientId) {
  return api(`/api/clients/${clientId}`, undefined, { method: "DELETE" }).then((res) => {
    dropCache("clients:");
    dropCache(KEY.clientDetail(clientId));
    // 该客户名下的所有派生缓存也一并清掉，避免残留占空间
    dropCache(casePrefix(clientId));
    return res;
  });
}
