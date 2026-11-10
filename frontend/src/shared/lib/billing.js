// 计费解析入口（上传解析 / AI 解析 / 文档 OCR）在积分不足时统一返回 402，
// 由页面据此拉起「前往充值」的提示，而不是让用户对着服务端文案猜下一步。
export const INSUFFICIENT_POINTS_STATUS = 402;

export function isInsufficientPointsError(error) {
  if (!error) return false;
  return Number(error.status) === INSUFFICIENT_POINTS_STATUS;
}
