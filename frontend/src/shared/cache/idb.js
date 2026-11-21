/* global __BUILD_ID__ */
// 浏览器端持久缓存（IndexedDB）。
//
// 为什么不用 localStorage：它只能存字符串、同步阻塞主线程、容量约 5MB。
// 原件页图是二进制 Blob，单页几百 KB，一叠几十页就爆了。
// IndexedDB 能直接存 Blob 与结构化对象、容量按配额走（几百 MB 到数 GB）、
// 异步不卡界面，还能跨刷新、跨会话保留。
//
// 两条独立的清理线：
//   1) 版本线：前端每次 build 生成新的 __BUILD_ID__，与库里记录不一致就整库清空。
//      上线新版本 → 旧结构/旧字段的缓存自动作废，不需要用户手动清。
//   2) 时间线：每条记录带自己的 ttl，读的时候判过期，容量超限时 LRU 淘汰。
//      这两条互不干扰：没发版时靠 ttl，发版时靠版本。
//
// 配额策略（经验值）：
//   - 总上限 200MB：留足余量。一旦触及浏览器整体配额，可能整站存储被驱逐，
//     连带别的数据一起没掉，所以宁可提前 LRU 淘汰也不去顶天花板。
//   - 单条上限 8MB：正常 A4 扫描页 100~400KB，超过 8MB 基本是异常大图。
//   - 条目上限 2000：200MB / 平均 100KB ≈ 2000，与字节上限互为保险。
//   - 淘汰按 lastUsed（最后一次读到），不是写入时间：反复看的要留下。

const DB_NAME = "qingliu-cache";
const DB_VERSION = 2;
const STORE_KV = "kv";
const STORE_META = "meta";

const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 2000;

// 构建版本：Vite 在 build 时把 __BUILD_ID__ 换成时间戳。
// 开发模式没有该常量，退化成固定值（本地不反复清缓存）。
const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

let dbPromise = null;
let readyPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        const kv = db.createObjectStore(STORE_KV, { keyPath: "key" });
        kv.createIndex("lastUsed", "lastUsed");
        kv.createIndex("expiresAt", "expiresAt");
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    // 隐私模式 / 存储被禁用：整体降级为"不缓存"，不能让页面挂掉
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function req2p(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// 版本变了就整库清空：前端上线新版本 → 旧缓存自动作废。
async function ensureVersion() {
  const db = await openDB();
  const meta = await req2p(
    db.transaction([STORE_META], "readonly").objectStore(STORE_META).get("version"),
  );
  if (meta && meta.value === BUILD_ID) return;

  const t = db.transaction([STORE_KV, STORE_META], "readwrite");
  t.objectStore(STORE_KV).clear();
  t.objectStore(STORE_META).put({ key: "version", value: BUILD_ID });
  await txDone(t);
}

function ready() {
  if (!readyPromise) {
    readyPromise = ensureVersion().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

function isExpired(row) {
  return !row || (row.expiresAt && row.expiresAt <= Date.now());
}

/**
 * 读一条缓存。过期返回 undefined（并顺手删掉），未命中返回 undefined。
 * @returns {Promise<any|undefined>}
 */
export async function idbGet(key) {
  await ready();
  const db = await openDB();
  const row = await req2p(
    db.transaction([STORE_KV], "readonly").objectStore(STORE_KV).get(key),
  );
  if (!row) return undefined;
  if (isExpired(row)) {
    idbDelete(key).catch(() => {});
    return undefined;
  }
  // 异步补记访问时间供 LRU 使用，不阻塞返回
  try {
    const t = db.transaction([STORE_KV], "readwrite");
    const store = t.objectStore(STORE_KV);
    store.put({ ...row, lastUsed: Date.now() });
  } catch {
    /* 记不上不影响读取 */
  }
  return row.value;
}

/**
 * 写一条缓存。
 * @param {string} key
 * @param {any} value Blob 或可结构化克隆的对象
 * @param {{ttlMs?: number, tags?: string[], size?: number}} opts
 *   ttlMs <= 0 表示不过期（靠版本线和 LRU 管）。
 */
export async function idbPut(key, value, { ttlMs = 0, tags = [], size = 0 } = {}) {
  let bytes = size;
  if (!bytes) {
    if (value instanceof Blob) bytes = value.size;
    else {
      try {
        bytes = new Blob([JSON.stringify(value)]).size;
      } catch {
        bytes = 0;
      }
    }
  }
  if (bytes > MAX_ENTRY_BYTES) return;

  await ready();
  const db = await openDB();
  const now = Date.now();
  await req2p(
    db
      .transaction([STORE_KV], "readwrite")
      .objectStore(STORE_KV)
      .put({
        key,
        value,
        size: bytes,
        tags,
        created: now,
        lastUsed: now,
        expiresAt: ttlMs > 0 ? now + ttlMs : 0,
      }),
  );
  evict();
}

export async function idbDelete(key) {
  const db = await openDB();
  await req2p(
    db.transaction([STORE_KV], "readwrite").objectStore(STORE_KV).delete(key),
  );
}

/** 按 key 前缀批量失效，例如 dropPrefix(`case:${cid}:`)。 */
export async function idbDeletePrefix(prefix) {
  if (!prefix) return;
  const db = await openDB();
  const keys = await req2p(
    db.transaction([STORE_KV], "readonly").objectStore(STORE_KV).getAllKeys(),
  );
  const victims = keys.filter((k) => typeof k === "string" && k.startsWith(prefix));
  if (!victims.length) return;
  const t = db.transaction([STORE_KV], "readwrite");
  const store = t.objectStore(STORE_KV);
  for (const k of victims) store.delete(k);
  await txDone(t);
}

export async function idbClear() {
  const db = await openDB();
  await req2p(
    db.transaction([STORE_KV], "readwrite").objectStore(STORE_KV).clear(),
  );
}

/** LRU 淘汰：超条数或超字节就删最久没被读过的。 */
async function evict() {
  try {
    const db = await openDB();
    const rows = await req2p(
      db.transaction([STORE_KV], "readonly").objectStore(STORE_KV).getAll(),
    );
    if (!rows.length) return;

    let total = rows.reduce((sum, r) => sum + (r.size || 0), 0);
    const expired = rows.filter(isExpired).map((r) => r.key);
    if (rows.length <= MAX_ENTRIES && total <= MAX_TOTAL_BYTES && !expired.length) return;

    const alive = rows.filter((r) => !isExpired(r));
    alive.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));

    const victims = [...expired];
    let remain = total;
    for (const r of expired) remain -= r.size || 0;
    for (const r of alive) {
      if (alive.length - victims.length <= MAX_ENTRIES && remain <= MAX_TOTAL_BYTES) break;
      if (victims.includes(r.key)) continue;
      victims.push(r.key);
      remain -= r.size || 0;
    }
    if (!victims.length) return;

    const t = db.transaction([STORE_KV], "readwrite");
    const store = t.objectStore(STORE_KV);
    for (const k of victims) store.delete(k);
    await txDone(t);
  } catch {
    /* 淘汰失败不影响主流程 */
  }
}

/** 统计：多少条、占多少空间、按前缀分布。用于排查与设置页展示。 */
export async function idbStats() {
  try {
    const db = await openDB();
    const rows = await req2p(
      db.transaction([STORE_KV], "readonly").objectStore(STORE_KV).getAll(),
    );
    const groups = {};
    for (const r of rows) {
      const g = String(r.key).split(":")[0] || "other";
      groups[g] = groups[g] || { entries: 0, bytes: 0 };
      groups[g].entries += 1;
      groups[g].bytes += r.size || 0;
    }
    return {
      entries: rows.length,
      bytes: rows.reduce((s, r) => s + (r.size || 0), 0),
      expired: rows.filter(isExpired).length,
      limitBytes: MAX_TOTAL_BYTES,
      limitEntries: MAX_ENTRIES,
      version: BUILD_ID,
      groups,
    };
  } catch {
    return {
      entries: 0,
      bytes: 0,
      expired: 0,
      limitBytes: MAX_TOTAL_BYTES,
      limitEntries: MAX_ENTRIES,
      version: BUILD_ID,
      groups: {},
    };
  }
}

/** 主动清掉已过期的条目（低频调用即可，例如进入设置页时）。 */
export async function idbSweepExpired() {
  try {
    await ready();
    await evict();
  } catch {
    /* 忽略 */
  }
}
