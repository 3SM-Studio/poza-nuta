import { PublicApiError } from "./public-api/errors";
// Coalesce only in-flight work. Completed results are never retained.
export function createSongSearchSingleFlight<T>() {
  const pendingByDatabase = new WeakMap<object, Map<string, Promise<T>>>();
  return (database: object, key: string, load: () => Promise<T>): Promise<T> => {
    let pending = pendingByDatabase.get(database);
    if (!pending) { pending = new Map(); pendingByDatabase.set(database, pending); }
    const current = pending.get(key);
    if (current) return current;
    // Bound pending distinct work as well as memory; duplicate waiters may join.
    if (pending.size >= 128) return Promise.reject(new PublicApiError(503,"SERVICE_UNAVAILABLE","The service is temporarily unavailable."));
    const result = Promise.resolve().then(load);
    pending.set(key, result);
    const clear = () => { if (pending.get(key) === result) pending.delete(key); };
    // Cleanup observes both outcomes. Original rejection still reaches callers.
    void result.then(clear, clear);
    return result;
  };
}
