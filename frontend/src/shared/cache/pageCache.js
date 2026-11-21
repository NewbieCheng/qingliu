import { idbGet, idbPut } from "./idb.js";

// 原件页图缓存：内存（当前标签页）→ IndexedDB（跨刷新、跨会话）→ 服务器。
//
// 三层的原因：
//   1) 内存 Map：同一页来回翻（比如对照上下两行都在同一页）零延迟。
//   2) IndexedDB：刷新页面、重新进客户还能直接用，不用再向服务器要图。
//   3) 服务器：真正没缓存时的唯一来源。
//
// blob URL 的生命周期：从缓存取出 Blob 后 createObjectURL。同一 key 复用同一个
// URL，避免反复 create 造成内存泄漏；只有在该标签页销毁时才由浏览器回收。

const urlCache = new Map(); // key -> objectURL
const inflight = new Map(); // key -> Promise, 防止同一页被并发请求多次

function keyOf(sha, page) {
  return `${sha || "nosha"}:${page}`;
}

export function cachedPageURL(sha, page) {
  return urlCache.get(keyOf(sha, page)) || "";
}

async function fetchAndStore(url, sha, page, signal) {
  const res = await fetch(url, { credentials: "include", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  // 写 IndexedDB 不阻断显示：先给用户看，再落盘
  // 页图由 sha + 页码唯一确定，内容永不变更 → 不按时间过期，只靠版本线与 LRU
  idbPut(keyOf(sha, page), blob).catch(() => {});
  return blob;
}

/**
 * 取原件某一页的图片 URL。
 * 优先内存 → IndexedDB → 网络，命中缓存时不产生任何请求。
 */
export async function loadPageURL({ cid, did, page, sha, buildURL, signal }) {
  const key = keyOf(sha, page);
  if (urlCache.has(key)) return urlCache.get(key);

  // 同一页同时被多个组件请求时共用一次网络请求
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    let blob = null;

    // 1) IndexedDB
    try {
      blob = await idbGet(key);
    } catch {
      blob = null;
    }

    // 2) 网络
    if (!blob) {
      blob = await fetchAndStore(buildURL(cid, did, page), sha, page, signal);
    }

    const objectURL = URL.createObjectURL(blob);
    urlCache.set(key, objectURL);
    return objectURL;
  })()
    .finally(() => inflight.delete(key))
    .catch((err) => {
      throw err;
    });

  inflight.set(key, task);
  return task;
}

/** 关闭面板时不必回收：同一份原件常被反复打开，留着重开就是秒开。 */
export function forgetSHA(sha) {
  const prefix = `${sha || "nosha"}:`;
  for (const [k, v] of urlCache) {
    if (k.startsWith(prefix)) {
      URL.revokeObjectURL(v);
      urlCache.delete(k);
    }
  }
}
