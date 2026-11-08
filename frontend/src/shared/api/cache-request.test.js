import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheQuery, clearApiCache } from "./cache.js";

describe("cached request coordination", () => {
  beforeEach(() => clearApiCache());

  it("does not share one request between different query keys", async () => {
    const origin = vi.fn(async (page) => ({ page }));
    await cacheQuery(() => origin(1), { key: "clients:a:1", ttlMs: 1000 });
    await cacheQuery(() => origin(2), { key: "clients:a:2", ttlMs: 1000 });
    expect(origin).toHaveBeenCalledTimes(2);
  });

  it("keeps cached values separate per key", async () => {
    await cacheQuery(async () => "first", { key: "k1", ttlMs: 1000 });
    await cacheQuery(async () => "second", { key: "k2", ttlMs: 1000 });
    const first = await cacheQuery(async () => "unused", { key: "k1", ttlMs: 1000 });
    const second = await cacheQuery(async () => "unused", { key: "k2", ttlMs: 1000 });
    expect(first).toBe("first");
    expect(second).toBe("second");
  });
});
