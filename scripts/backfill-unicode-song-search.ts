import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { assertLocalDatabaseTarget } from "../src/lib/local-target.ts";
import { backfillUnicodeSongSearchBatch } from "../src/db/song-search-backfill.ts";

// Deliberately no dotenv or cloud override. Production execution is not an
// option in this developer CLI; use an approved deployment-specific runbook.
const url = assertLocalDatabaseTarget(process.env.UNICODE_SEARCH_LOCAL_DATABASE_URL);
const client = postgres(url, { max: 1, prepare: false, connect_timeout: 5 });
try {
  const [{ version }] = await client<{ version: number }[]>`select current_setting('server_version_num')::int as version`;
  if (version < 170000 || version >= 180000) throw new Error("PostgreSQL 17 required.");
  const database = drizzle(client);
  let updated = 0, batch;
  do { batch = await backfillUnicodeSongSearchBatch(database); updated += batch; } while (batch > 0);
  const [{ missing }] = await client<{ missing: number }[]>`select count(*)::int as missing from songs s where not exists(select 1 from song_search_documents d where d.song_id=s.id and d.normalization_version=2)`;
  console.log(JSON.stringify({ projectionRowsWritten: updated, missing }));
  if (missing !== 0) throw new Error("Backfill incomplete: locked rows remain; rerun safely.");
} finally { await client.end({ timeout: 5 }); }
