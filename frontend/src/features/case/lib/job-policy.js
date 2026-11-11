/** 按任务 kind 配轮询/陈旧阈值；与 server/job_policy.go 语义对齐。 */

const POLICIES = {
  upload: { pollMs: 2500, staleMinutes: 45, locksBusy: true },
  report: { pollMs: 3000, staleMinutes: 30, locksBusy: true },
  ai_analysis: { pollMs: 4000, staleMinutes: 90, locksBusy: false },
  page_ocr: { pollMs: 4000, staleMinutes: 90, locksBusy: false },
  default: { pollMs: 3000, staleMinutes: 30, locksBusy: false },
};

export function jobPolicy(kind) {
  return POLICIES[kind] || POLICIES.default;
}
