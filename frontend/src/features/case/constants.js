/** 四步底稿步骤码；展示文案用 t(`step.${key}`) */
export const CASE_STEPS = ["upload", "ownership", "review", "report"].map(
  (key) => [key],
);

/** 核对视图码 → i18n key */
export const CASE_VIEWS = {
  issues: "review.view_issues",
  all: "review.view_all",
  confirmed: "review.view_confirmed",
  duplicate: "review.view_duplicate",
};

/** 批量核对选项：[value, i18n key] */
export const REVIEW_OPTIONS = [
  ["included", "review.option.included"],
  ["excluded", "review.option.excluded"],
  ["pending", "review.option.pending"],
  ["duplicate", "review.option.duplicate"],
  ["expense", "review.option.expense"],
  ["neutral", "review.option.neutral"],
  ["undo", "review.option.undo"],
];
