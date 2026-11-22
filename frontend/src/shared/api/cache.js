import { idbGet, idbPut, idbDeletePrefix, idbClear } from "@/shared/cache/idb.js";
import { TTL, PERSIST } from "@/shared/cache/policy.js";

// 两级缓存 + 单飞。
//
// 一级：内存 Map（当前标签页，最快的命中，不做序列化）
// 二级：IndexedDB（跨刷新、跨会话，能存 Blob 与结构化对象）
//
// 为什么要两级：内存命中是微秒级，但刷新就没了；IndexedDB 能活很久，
// 但每次读要过结构化克隆。热点数据留在内存，冷数据落盘，各取所长。
//
// 单飞（single flight）：同一 key 并发请求只发一次。
// 典型场景是入口卡和弹窗同时渲染，不去重就会打两次接口。

const DEFAULT_TTL_MS = TTL.volatile;

const memory = new Map(); // key -> { value, expiresAt }
const pending = new Map(); // key -> Promise

function isFresh(entry) {
  return entry && (!entry.expiresAt || entry.expiresAt > Date.now());
}

/** 只看内存，同步返回。未命中返回 undefined。 */
export function readCache(key) {
  const entry = memory.get(key);
  if (!isFresh(entry)) {
    if (entry) memory.delete(key);
    return undefined;
  }
  return entry.value;
}

/** 写内存（同步）。ttlMs <= 0 表示不过期。 */
export function writeCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  memory.set(key, { value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 });
  return value;
}

/**
 * 两级读取：内存 → IndexedDB。
 * persist 为 false 时只读内存（高频数据不落盘，也就没有二级）。
 */
export async function readCacheDeep(key, persist = true) {
  const hit = readCache(key);
  if (hit !== undefined) return hit;
  if (!persist) return undefined;
  try {
    const disk = await idbGet(key);
    if (disk !== undefined) {
      // 回填内存，下次同标签页直接命中
      memory.set(key, { value: disk, expiresAt: 0 });
      return disk;
    }
  } catch {
    /* IndexedDB 不可用就当作没缓存 */
  }
  return undefined;
}

/** 按前缀失效：内存与 IndexedDB 一起清。 */
export function dropCache(prefix) {
  if (!prefix) {
    memory.clear();
    pending.clear();
    idbClear().catch(() => {});
    return;
  }
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  for (const key of pending.keys()) {
    if (key.startsWith(prefix)) pending.delete(key);
  }
  idbDeletePrefix(prefix).catch(() => {});
}

/**
 * 带缓存地执行一次取数。
 *
 * @param {Function} fn 回源函数
 * @param {object} opts
 * @param {string} opts.key 缓存键（用 policy.js 的 KEY.*）
 * @param {number} [opts.ttlMs] 存活时间，<=0 表示不过期
 * @param {boolean} [opts.persist] 是否落 IndexedDB
 * @param {boolean} [opts.force] 强制回源（刷新按钮用）
 * @param {Function} [opts.shouldCache] 返回 false 则不写入（比如错误响应）
 */
export async function cacheQuery(fn, opts = {}) {
  const {
    key,
    ttlMs = DEFAULT_TTL_MS,
    persist = true,
    force = false,
    shouldCache,
  } = opts;

  if (!key) return fn();

  // 同步内存命中最快；并发单飞必须在任何 await 之前挂上 pending，
  // 否则两个调用都会各自穿过 await readCacheDeep 再各打一次回源。
  if (!force) {
    const memHit = readCache(key);
    if (memHit !== undefined) return memHit;
  } else {
    // 强制刷新：先把旧的清掉，避免回源失败时又读到旧值
    memory.delete(key);
  }

  const inflight = pending.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    if (!force) {
      const hit = await readCacheDeep(key, persist);
      if (hit !== undefined) return hit;
    }
    const value = await fn();
    if (shouldCache && !shouldCache(value)) return value;
    writeCache(key, value, ttlMs);
    if (persist) {
      idbPut(key, value, { ttlMs }).catch(() => {});
    }
    return value;
  })().finally(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });

  pending.set(key, promise);
  return promise;
}

export async function clearApiCache() {
  memory.clear();
  pending.clear();
  try {
    await idbClear();
  } catch {
    /* 忽略 */
  }
}

/** 供排查/设置页：当前内存里有多少条。 */
export function memoryStats() {
  return { entries: memory.size, pending: pending.size };
}

export { TTL, PERSIST };
