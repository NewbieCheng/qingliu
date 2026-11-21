import { api } from "@/shared/api/client.js";

export function listClients({ query = "", page = 1, signal } = {}) {
  const search = new URLSearchParams({ q: query, page: String(page) });
  return api(`/api/clients?${search}`, undefined, { signal });
}

export function createClient(payload) {
  return api("/api/clients", payload);
}

/** 删除客户档案：后端会连库里的关联数据与磁盘原件一起清理。 */
export function deleteClient(clientId) {
  return api(`/api/clients/${clientId}`, undefined, { method: "DELETE" });
}
