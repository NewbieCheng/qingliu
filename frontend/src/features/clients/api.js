import { api } from "@/shared/api/client.js";

export function listClients({ query = "", page = 1, signal } = {}) {
  const search = new URLSearchParams({ q: query, page: String(page) });
  return api(`/api/clients?${search}`, undefined, { signal });
}

export function createClient(payload) {
  return api("/api/clients", payload);
}
