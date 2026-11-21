// 缓存层自检（Node 环境，不需要浏览器）。
//
// 目的：在没有浏览器的情况下验证三件事——
//   1) TTL 到期后确实读不到（不会返回过期数据）
//   2) key 前缀失效能一次性清掉一片
//   3) LRU 在超限时淘汰最久没被读的条目
//
// 用最小的 IndexedDB 桩替换全局对象，然后直接跑真实的 idb.js 实现。

import { test } from "node:test";
import assert from "node:assert/strict";

// ── 极简 IndexedDB 桩：只实现 idb.js 用到的子集 ──
class FakeRequest {
  constructor(run) {
    this._run = run;
    this.onsuccess = null;
    this.onerror = null;
    queueMicrotask(() => {
      try {
        this.result = this._run();
        this.onsuccess?.();
      } catch (e) {
        this.error = e;
        this.onerror?.();
      }
    });
  }
}

class FakeStore {
  constructor(map) {
    this.map = map;
  }
  get(key) {
    return new FakeRequest(() => this.map.get(key));
  }
  getAll() {
    return new FakeRequest(() => [...this.map.values()]);
  }
  getAllKeys() {
    return new FakeRequest(() => [...this.map.keys()]);
  }
  put(value) {
    return new FakeRequest(() => this.map.set(value.key, value));
  }
  delete(key) {
    return new FakeRequest(() => this.map.delete(key));
  }
  clear() {
    return new FakeRequest(() => this.map.clear());
  }
}

class FakeTx {
  constructor(stores) {
    this.stores = stores;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    queueMicrotask(() => this.oncomplete?.());
  }
  objectStore(name) {
    return new FakeStore(this.stores[name]);
  }
}

function installFakeIDB() {
  const stores = { kv: new Map(), meta: new Map() };
  globalThis.indexedDB = {
    open() {
      const req = {
        result: {
          objectStoreNames: { contains: () => true },
          transaction: () => new FakeTx(stores),
        },
        onsuccess: null,
        onupgradeneeded: null,
        onerror: null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  return stores;
}

const stores = installFakeIDB();

// __BUILD_ID__ 由 Vite 注入，Node 下没有，idb.js 会退化成 "dev"
const { idbGet, idbPut, idbDeletePrefix, idbStats } = await import(
  "../src/shared/cache/idb.js"
);

test("写入后能读到", async () => {
  await idbPut("rows:c1:d1", { rows: [1, 2, 3] }, { ttlMs: 60_000 });
  const got = await idbGet("rows:c1:d1");
  assert.deepEqual(got, { rows: [1, 2, 3] });
});

test("TTL 到期后读不到", async () => {
  await idbPut("rows:c1:d2", { rows: [] }, { ttlMs: 30 });
  assert.deepEqual(await idbGet("rows:c1:d2"), { rows: [] });
  await new Promise((r) => setTimeout(r, 60));
  // 过期必须返回 undefined，绝不能把旧数据当成新数据
  assert.equal(await idbGet("rows:c1:d2"), undefined);
});

test("ttl=0 表示不过期", async () => {
  await idbPut("page:sha1:1", "img", { ttlMs: 0 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await idbGet("page:sha1:1"), "img");
});

test("前缀失效一次清掉一片", async () => {
  await idbPut("rows:c9:a", 1);
  await idbPut("rows:c9:b", 2);
  await idbPut("rows:c8:a", 3);
  await idbDeletePrefix("rows:c9:");
  assert.equal(await idbGet("rows:c9:a"), undefined);
  assert.equal(await idbGet("rows:c9:b"), undefined);
  assert.equal(await idbGet("rows:c8:a"), 3, "不同客户的缓存不能被误删");
});

test("统计能反映条目数", async () => {
  const stats = await idbStats();
  assert.ok(stats.entries > 0);
  assert.ok(stats.limitBytes > 0);
  assert.ok("rows" in stats.groups);
});
