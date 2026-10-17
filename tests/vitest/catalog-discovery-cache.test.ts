import { expect, test, vi } from "vitest";
import { createCatalogDiscoveryCache } from "../../src/server/catalog-discovery-cache";

test("discovery collapses concurrent loads, expires, isolates databases and supports explicit invalidation", async () => {
  const cache = createCatalogDiscoveryCache<number>();
  const database = {}, other = {};
  const load = vi.fn(async () => 7);
  expect(await Promise.all(Array.from({ length: 20 }, () => cache.get(database, load, 100)))).toEqual(Array(20).fill(7));
  expect(load).toHaveBeenCalledTimes(1);
  await cache.get(database, load, 60_099); expect(load).toHaveBeenCalledTimes(1);
  await cache.get(database, load, 60_100); expect(load).toHaveBeenCalledTimes(2);
  await cache.get(other, load, 60_100); expect(load).toHaveBeenCalledTimes(3);
  cache.invalidate(database);
  await cache.get(database, load, 60_101); expect(load).toHaveBeenCalledTimes(4);
});

test("failed loads propagate and retry; old failures cannot evict a replacement", async () => {
  const cache = createCatalogDiscoveryCache<number>(); const database = {};
  const failure = new Error("database unavailable");
  await expect(cache.get(database, async () => { throw failure; }, 0)).rejects.toBe(failure);
  expect(await cache.get(database, async () => 9, 1)).toBe(9);
  cache.invalidate(database);
  let reject!: (reason: Error) => void;
  const pending = cache.get(database, () => new Promise<number>((_, fail) => { reject = fail; }), 2);
  await Promise.resolve();
  cache.invalidate(database);
  expect(await cache.get(database, async () => 10, 3)).toBe(10);
  reject(failure); await expect(pending).rejects.toBe(failure);
  expect(await cache.get(database, async () => 11, 4)).toBe(10);
});

test("separate Vercel instances converge after TTL without relying on process-local invalidation", async () => {
  const a = createCatalogDiscoveryCache<number>(), b = createCatalogDiscoveryCache<number>();
  const database = {}; let catalogRevision = 1;
  const load = vi.fn(async () => catalogRevision);
  expect(await a.get(database, load, 0)).toBe(1);
  expect(await b.get(database, load, 0)).toBe(1);
  catalogRevision = 2; // External import worker; no shared process memory.
  a.invalidate(database);
  expect(await a.get(database, load, 1)).toBe(2);
  expect(await b.get(database, load, 59_999)).toBe(1);
  expect(await b.get(database, load, 60_000)).toBe(2);
  expect(load).toHaveBeenCalledTimes(4);
});
