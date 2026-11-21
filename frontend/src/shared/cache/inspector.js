import { idbStats, idbClear, idbSweepExpired } from "./idb.js";
import { memoryStats, clearApiCache } from "@/shared/api/cache.js";

// 缓存自检：把"到底有没有缓存住、占多少、过期多少"暴露出来。
//
// 没有可观测性的缓存等于没有缓存——出问题时无法判断是没写进去、
// 还是写了但读错 key、还是被 LRU 提前淘汰。这个对象挂在 window 上，
// 打开控制台执行 `__qlCache.report()` 就能看到全貌。

async function report() {
  const disk = await idbStats();
  const mem = memoryStats();
  const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
  const rows = [
    ["构建版本", disk.version],
    ["内存条目", mem.entries],
    ["磁盘条目", disk.entries],
    ["磁盘占用", `${mb(disk.bytes)} / ${mb(disk.limitBytes)}`],
    ["已过期待清理", disk.expired],
    ["进行中请求", mem.pending],
  ];
  // eslint-disable-next-line no-console
  console.table(
    Object.fromEntries(rows.map(([k, v]) => [k, v])),
  );
  if (Object.keys(disk.groups).length) {
    // eslint-disable-next-line no-console
    console.table(disk.groups);
  }
  return { ...disk, memory: mem };
}

async function clear() {
  await clearApiCache();
  await idbClear();
  // eslint-disable-next-line no-console
  console.info("[qingliu] 缓存已清空");
}

export function installCacheInspector() {
  if (typeof window === "undefined") return;
  window.__qlCache = { report, clear, sweep: idbSweepExpired };
}
