/** 列表筛选桶：待上传 / 可继续 / 处理中 */
export function clientBucket(client) {
  if (Number(client.running) > 0) return "running";
  if (!Number(client.doc_count)) return "pending";
  return "ready";
}

/** 下一步文案：状态本身就是行动提示 */
export function clientNextStep(client) {
  const docs = Number(client.doc_count) || 0;
  switch (clientBucket(client)) {
    case "running":
      return {
        label: "识别中",
        labelKey: "clients.step_parsing",
        tone: "amber",
        docs,
        action: "",
      };
    case "pending":
      return {
        label: "待上传资料",
        labelKey: "clients.step_pending_upload",
        tone: "amber",
        docs: 0,
        action: "去上传",
        actionKey: "clients.step_go_upload",
      };
    default:
      return {
        label: "继续核对",
        labelKey: "clients.step_continue_review",
        tone: "default",
        docs,
        action: "",
      };
  }
}

export const CLIENT_FILTERS = [
  { value: "all", label: "All", labelKey: "clients.filter_all" },
  { value: "pending", label: "待上传", labelKey: "clients.filter_pending" },
  { value: "ready", label: "可继续", labelKey: "clients.filter_ready" },
  { value: "running", label: "Running", labelKey: "clients.filter_running" },
];

export function filterClients(clients, filter) {
  if (!filter || filter === "all") return clients;
  return clients.filter((client) => clientBucket(client) === filter);
}
