export const RELATIONSHIPS = ["Self", "配偶", "子女", "Other"];

export const RELATIONSHIP_KEYS = {
  Self: "ownership.rel_self",
  配偶: "ownership.rel_spouse",
  子女: "ownership.rel_child",
  Other: "ownership.rel_other",
};

const RELATIONSHIP_ALIASES = {
  本人: "Self",
  其他: "Other",
};

/** 将历史中文值或标准枚举值统一成后端约定枚举，避免编辑回显错位。 */
export function normalizeRelationship(value) {
  const raw = String(value || "").trim();
  return RELATIONSHIP_ALIASES[raw] || raw;
}

/** 读取已保存的持有人确认状态，重进页面时不必重复逐行点 ✓。 */
export function initialConfirmedMap(docs = [], scopes = {}) {
  const next = {};
  for (const doc of docs) {
    const scope = scopes?.[doc.id];
    if (scope?.confirmed && String(scope.holder || "").trim()) {
      next[doc.id] = true;
    }
  }
  return next;
}
