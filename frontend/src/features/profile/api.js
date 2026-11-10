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

/** 这个人能进的**空间**：个人空间 + 全部有效的团队/平台成员关系。 */
export function listSpaces() {
  return api("/api/spaces");
}

/**
 * 切换当前会话所在的空间。
 *
 * 空间用工作台的 `{kind, id}` 表达（kind ∈ personal|team|platform），
 * 不再是一个 tenant_id —— 一个整数表达不了三种空间。
 *
 * 只改**本会话**（服务端 ql_sessions.space_kind/space_id），不影响同一个人
 * 在其他设备上的登录；切换后所有按空间收口的接口（客户列表、余额、操作记录）
 * 都换了视角，因此调用方必须在成功后清空前端查询缓存。
 */
export function switchSpace(kind, id) {
  return api("/api/switch-space", { kind, id });
}

/**
 * 开启一个还没开启的空间（列表里 status === "locked"）。
 *
 * 准入规则在工作台（成员关系 + 状态），清流只是转发；开启成功后服务端直接
 * 回最新列表，因此这里返回的就是可以重绘的数据。
 */
export function enableSpace(kind, id) {
  return api("/api/spaces/enable", { kind, id });
}
