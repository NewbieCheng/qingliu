/** 核对表服务端分页：与 server/main.go GET /api/clients/{cid} 的每页 50 对齐。 */
export const REVIEW_PAGE_SIZE = 50;

export function reviewTotalPages(rowCount) {
  const total = Math.max(0, Number(rowCount) || 0);
  if (total === 0) return 1;
  return Math.ceil(total / REVIEW_PAGE_SIZE);
}

export function reviewPagerLabel(page, rowCount) {
  const current = Math.max(1, Number(page) || 1);
  const totalPages = reviewTotalPages(rowCount);
  const total = Math.max(0, Number(rowCount) || 0);
  return `第 ${current} / ${totalPages} 页 · 共 ${total} 笔`;
}

export function reviewCanNext(page, rowCount) {
  return Math.max(1, Number(page) || 1) * REVIEW_PAGE_SIZE < Math.max(0, Number(rowCount) || 0);
}
