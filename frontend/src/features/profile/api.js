import { api } from "@/shared/api/client.js";

export function getProfile() {
  return api("/api/me");
}

export function changePassword(payload) {
  return api("/api/password", payload);
}

export function logout() {
  return api("/api/logout", {});
}
