import "server-only";
import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { PublicApiError } from "./public-api/errors";
import {traceDbOperation,traceDbTransaction} from './db-telemetry';

// Two-int advisory keys do not overlap the existing bigint participant locks.
// Shared across application instances in one database; never a session lock.
export const SONG_SEARCH_LOCK_NAMESPACE = 0x4b535243;
export const SONG_SEARCH_ADMISSION_WAIT_MS = 6_000;
type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function withSongSearchAdmission<T>(run: (transaction: Transaction) => Promise<T>): Promise<T> {
  const started = performance.now();
  let attempts = 0;
  for (;;) {
    const result = await traceDbTransaction('song_search','song_search.admission_transaction',onStarted=>getDb().transaction(async transaction => {
      onStarted();
      // A queued pool checkout must not start obsolete expensive SQL after the
      // admission budget. BEGIN/COMMIT still belong to the driver transaction.
      if (performance.now() - started >= SONG_SEARCH_ADMISSION_WAIT_MS) return {admitted:false} as const;
      const [permit] = await traceDbOperation('song_search','song_search.admission_permit',()=>transaction.execute<{ slot: number }>(sql`select case
        when pg_catalog.pg_try_advisory_xact_lock(${SONG_SEARCH_LOCK_NAMESPACE}, 1) then 1
        when pg_catalog.pg_try_advisory_xact_lock(${SONG_SEARCH_LOCK_NAMESPACE}, 2) then 2
        else 0 end as slot`));
      if (!permit || ![0,1,2].includes(permit.slot)) throw new Error("Invalid search admission response.");
      if (permit.slot === 0) return { admitted: false } as const;
      return { admitted: true, value: await run(transaction) } as const;
    }));
    if (result.admitted) return result.value;
    attempts++;
    const elapsed = performance.now() - started;
    if (elapsed >= SONG_SEARCH_ADMISSION_WAIT_MS) {
      console.info(JSON.stringify({event:"song_search_capacity",phase:"exhausted",attempts,wait_ms:Math.round(elapsed)}));
      throw new PublicApiError(503,"SERVICE_UNAVAILABLE","The service is temporarily unavailable.");
    }
    // Busy transactions have already committed. Neither a database connection
    // nor a lock is held during bounded, jittered application-side backoff.
    const delay = Math.min(200, 25 * 2 ** Math.min(attempts - 1, 3)) * (0.8 + Math.random() * 0.2);
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, SONG_SEARCH_ADMISSION_WAIT_MS - elapsed)));
  }
}
