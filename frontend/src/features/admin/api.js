import { api } from "@/shared/api/client.js";

export function getAdminOverview() {
  return api("/api/admin");
}

export function listAuditEvents(search = "") {
  return api(`/api/admin/audit${search ? `?${search}` : ""}`);
}

export function createMember(payload) {
  return api("/api/admin/users", payload);
}

export function toggleMember(userId) {
  return api(`/api/admin/users/${userId}/toggle`, {});
}
