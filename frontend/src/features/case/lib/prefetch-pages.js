/**
 * 邻页预取：当前页加载成功后静默预取 page±1，加速翻页。
 * 失败忽略；权威仍在服务端原件接口。
 */

import { originalPageURL } from "../api.js";
import { loadPagePreview, readPagePreview } from "./page-preview-cache.js";

export function neighborPages(page, total) {
  const current = Math.max(1, Number(page) || 1);
  const max = Math.max(1, Number(total) || 1);
  const next = [];
  if (current - 1 >= 1) next.push(current - 1);
  if (current + 1 <= max) next.push(current + 1);
  return next;
}

/**
 * @param {object} options
 * @param {string} options.cid
 * @param {string} options.documentId
 * @param {string} [options.sha]
 * @param {number} options.page
 * @param {number} options.total
 */
export async function prefetchNeighborPages({
  cid,
  documentId,
  sha,
  page,
  total,
}) {
  const targets = neighborPages(page, total);
  await Promise.all(
    targets.map(async (target) => {
      try {
        if (sha) {
          const cached = await readPagePreview(cid, documentId, target, sha);
          if (cached) return;
        }
        const url = await loadPagePreview(
          cid,
          documentId,
          target,
          sha || "",
          originalPageURL(cid, documentId, target),
        );
        // loadPagePreview 返回 object URL；预取只需写入缓存，立刻释放。
        URL.revokeObjectURL(url);
      } catch {
        // 预取失败不影响当前页
      }
    }),
  );
}
