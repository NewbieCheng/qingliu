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

/** 这个人能进的**空间**：个人空间 + 全部分有效企业成员关系。 */
export function listSpaces() {
  return api("/api/spaces");
}

/**
 * 切换当前会话所在的空间。
 *
 * 只改**本会话**（服务端 ql_sessions.tenant_id），不影响同一个人在其他设备上
 * 的登录；切换后所有按空间收口的接口（客户列表、余额、操作记录）都换了视角，
 * 因此调用方必须在成功后清空前端查询缓存。
 */
export function switchSpace(tenantId) {
  return api("/api/switch-space", { tenant_id: tenantId });
}
