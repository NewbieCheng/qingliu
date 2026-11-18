const DEFAULT_TTL_MS = 10_000;
const store = new Map();
/** 同 key 进行中的请求单飞，避免入口卡与弹窗同时打两次。 */
const pending = new Map();

function now() {
  return Date.now();
}

function isFresh(entry) {
  return entry && entry.expiresAt > now();
}

export function readCache(key) {
  const entry = store.get(key);
  if (!isFresh(entry)) {
    if (entry) store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function writeCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: now() + Math.max(0, ttlMs) });
  return value;
}

export function dropCache(prefix) {
  if (!prefix) {
    store.clear();
    pending.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of pending.keys()) {
    if (key.startsWith(prefix)) pending.delete(key);
  }
}

export function cacheQuery(fn, { key, ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  if (!force) {
    const hit = readCache(key);
    if (hit !== undefined) return Promise.resolve(hit);
  }
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const promise = Promise.resolve(fn())
    .then((value) => writeCache(key, value, ttlMs))
    .finally(() => {
      if (pending.get(key) === promise) pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
}

export function clearApiCache() {
  store.clear();
  pending.clear();
}
