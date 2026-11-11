/**
 * 核对页 AI 预勾：高置信 suggested 可一键采纳；已采纳可撤销。
 */

export function highConfidenceSuggested(rows) {
  return (rows || []).filter(
    (row) =>
      row?.ai_status === "suggested" &&
      row?.ai_confidence === "high" &&
      row?.ai_label &&
      !row.scope_excluded &&
      row.quality !== "invalid" &&
      !row.review_label,
  );
}

export function adoptedAIRows(rows) {
  return (rows || []).filter((row) => row?.ai_status === "adopted");
}

export function aiStatusLabel(row) {
  switch (row?.ai_status) {
    case "suggested":
      return row.ai_confidence === "high"
        ? `AI 建议·高置信（${row.ai_label}）`
        : `AI 建议（${row.ai_label || "待核"}）`;
    case "adopted":
      return "已采纳 AI";
    case "overridden":
      return "已改标";
    default:
      return "";
  }
}
