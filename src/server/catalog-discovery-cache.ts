// Per database / process. No event, participant or authorization data is cached.
// Other processes (including import workers) converge through the 60s TTL.
export const CATALOG_DISCOVERY_TTL_MS = 60_000;

export function createCatalogDiscoveryCache<T>() {
  const entries = new WeakMap<object, { expiresAt: number; promise: Promise<T> }>();
  return {
    get(database: object, load: () => Promise<T>, now = Date.now()): Promise<T> {
      const current = entries.get(database);
      if (current && current.expiresAt > now) return current.promise;
      const entry = { expiresAt: now + CATALOG_DISCOVERY_TTL_MS, promise: Promise.resolve().then(load) };
      entries.set(database, entry);
      // Never cache failures or let an old failure evict a newer generation.
      void entry.promise.catch(() => {
        if (entries.get(database) === entry) entries.delete(database);
      });
      return entry.promise;
    },
    invalidate(database: object) { entries.delete(database); },
  };
}
