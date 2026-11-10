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
      return { label: "识别中", tone: "amber", docs, action: "" };
    case "pending":
      return { label: "待上传资料", tone: "amber", docs: 0, action: "去上传" };
    default:
      return { label: "继续核对", tone: "default", docs, action: "" };
  }
}

export const CLIENT_FILTERS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待上传" },
  { value: "ready", label: "可继续" },
  { value: "running", label: "处理中" },
];

export function filterClients(clients, filter) {
  if (!filter || filter === "all") return clients;
  return clients.filter((client) => clientBucket(client) === filter);
}
