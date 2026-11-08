import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheQuery,
  clearApiCache,
  dropCache,
  readCache,
  writeCache,
} from "./cache.js";

describe("api cache", () => {
  beforeEach(() => {
    clearApiCache();
    vi.useRealTimers();
  });

  it("returns a fresh value without calling the origin twice", async () => {
    const origin = vi.fn().mockResolvedValue({ ok: true });
    const first = await cacheQuery(origin, { key: "x", ttlMs: 1000 });
    const second = await cacheQuery(origin, { key: "x", ttlMs: 1000 });
    expect(first).toEqual({ ok: true });
    expect(second).toBe(first);
    expect(origin).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cache when force is true", async () => {
    const origin = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await cacheQuery(origin, { key: "x", ttlMs: 1000 });
    const value = await cacheQuery(origin, { key: "x", ttlMs: 1000, force: true });
    expect(value).toBe(2);
    expect(origin).toHaveBeenCalledTimes(2);
  });

  it("expires entries after the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    writeCache("ttl", "value", 1000);
    expect(readCache("ttl")).toBe("value");
    vi.advanceTimersByTime(1001);
    expect(readCache("ttl")).toBeUndefined();
  });

  it("drops entries by prefix without touching unrelated caches", () => {
    writeCache("clients:1", "a");
    writeCache("clients:2", "b");
    writeCache("profile:me", "c");
    dropCache("clients:");
    expect(readCache("clients:1")).toBeUndefined();
    expect(readCache("clients:2")).toBeUndefined();
    expect(readCache("profile:me")).toBe("c");
  });
});
