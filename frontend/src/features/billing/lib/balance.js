// 余额展示口径的实现放在 shared/lib/billing.js：顶栏（shared）也要用同一套读法，
// 而 shared 不允许依赖 features。这里保留同名导出，features 内部按原路径取用。
export {
  availablePoints,
  permanentPoints,
  periodExpiresAt,
  periodPoints,
} from "@/shared/lib/billing.js";
