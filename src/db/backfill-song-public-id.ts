import { performance } from "node:perf_hooks";

import { config } from "dotenv";
import postgres from "postgres";

import { requireAdminDatabaseUrl } from "./admin-database-url.ts";

export const defaultSongPublicIdBatchSize = 1_000;
export const maximumSongPublicIdBatchSize = 5_000;
const maximumAttemptsPerBatch = 3;
const maximumVerificationPasses = 3;

type BatchResult = { selected: number; updated: number; lastId: bigint };

export type SongPublicIdBackfillProgress = {
  processed: number;
  updated: number;
  remainingNull: number;
  batches: number;
  retries: number;
  elapsedMs: number;
};

export type SongPublicIdBackfillOptions = {
  batchSize?: number;
  onBatch?: (batch: { lastId: bigint; selected: number; updated: number; elapsedMs: number }) => Promise<void> | void;
};

export async function runSongPublicIdBackfill(
  sql: postgres.Sql,
  options: SongPublicIdBackfillOptions = {},
): Promise<SongPublicIdBackfillProgress> {
  const batchSize = options.batchSize ?? defaultSongPublicIdBatchSize;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > maximumSongPublicIdBatchSize) {
    throw new Error(`Batch size must be between 1 and ${maximumSongPublicIdBatchSize}.`);
  }

  await assertExpandSchema(sql);
  const started = performance.now();
  const progress = { processed: 0, updated: 0, remainingNull: 0, batches: 0, retries: 0, elapsedMs: 0 };

  for (let pass = 0; pass < maximumVerificationPasses; pass++) {
    let cursor = 0n;
    for (;;) {
      let result: BatchResult | undefined;
      const batchStarted = performance.now();
      for (let attempt = 1; attempt <= maximumAttemptsPerBatch; attempt++) {
        try {
          result = await updateNextBatch(sql, cursor, batchSize);
          break;
        } catch (error) {
          if (!isTransientConflict(error) || attempt === maximumAttemptsPerBatch) throw error;
          progress.retries++;
          await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
        }
      }
      if (!result) throw new Error("Song public ID batch retry limit reached.");
      if (result.selected === 0) break;

      cursor = result.lastId;
      progress.processed += result.selected;
      progress.updated += result.updated;
      progress.batches++;
      await options.onBatch?.({
        lastId: cursor,
        selected: result.selected,
        updated: result.updated,
        elapsedMs: performance.now() - batchStarted,
      });
    }

    progress.remainingNull = await countMissingIds(sql);
    if (progress.remainingNull === 0) {
      progress.elapsedMs = performance.now() - started;
      return progress;
    }
  }

  throw new Error("Song public ID backfill is incomplete after bounded verification passes.");
}

async function assertExpandSchema(sql: postgres.Sql): Promise<void> {
  const [state] = await sql<{
    column_type: string;
    column_default: string | null;
    is_nullable: string;
  }[]>`
    SELECT format_type(a.atttypid, a.atttypmod) AS column_type,
           pg_get_expr(d.adbin, d.adrelid) AS column_default,
           CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = 'songs' AND c.relkind = 'r'
      AND a.attname = 'public_id' AND NOT a.attisdropped
  `;
  if (state?.column_type !== "uuid" || state.column_default !== "gen_random_uuid()" || state.is_nullable !== "YES") {
    throw new Error("The songs.public_id expand schema is missing or does not match phase A.");
  }
}

async function updateNextBatch(sql: postgres.Sql, cursor: bigint, batchSize: number): Promise<BatchResult> {
  return sql.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL lock_timeout = '2s'");
    await transaction.unsafe("SET LOCAL statement_timeout = '8s'");
    const selected = await transaction.unsafe<{ id: string }[]>(
      `SELECT song.id::text AS id FROM public.songs AS song
       WHERE song.id > $1::bigint AND song.public_id IS NULL
       ORDER BY song.id LIMIT $2 FOR UPDATE`,
      [cursor.toString(), batchSize],
    );
    if (selected.length === 0) return { selected: 0, updated: 0, lastId: cursor };

    const ids = selected.map(({ id }) => id);
    const updated = await transaction.unsafe<{ id: string }[]>(
      `UPDATE public.songs SET public_id = gen_random_uuid()
       WHERE id = ANY($1::bigint[]) AND public_id IS NULL
       RETURNING id::text AS id`,
      [ids],
    );
    if (updated.length !== selected.length) {
      throw new Error("Song public ID batch did not update every selected NULL row.");
    }
    return { selected: selected.length, updated: updated.length, lastId: BigInt(ids.at(-1)!) };
  });
}

async function countMissingIds(sql: postgres.Sql): Promise<number> {
  const [row] = await sql<{ remaining: number }[]>`
    SELECT count(*)::integer AS remaining FROM public.songs WHERE public_id IS NULL
  `;
  return row.remaining;
}

function isTransientConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if (error.code === "55P03" || error.code === "40P01" || error.code === "40001") return true;
  return error.code === "57014" && "message" in error &&
    typeof error.message === "string" && error.message.includes("statement timeout");
}

function parseArguments(args: string[]): { batchSize: number; expectedProjectRef: string } {
  const usage = "Usage: pnpm db:backfill:song-public-id --expected-project-ref <ref> [--batch-size <n>]";
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--expected-project-ref", "--batch-size"].includes(flag) || values.has(flag)) {
      throw new Error(usage);
    }
    values.set(flag, value);
  }
  const expectedProjectRef = values.get("--expected-project-ref");
  if (!expectedProjectRef || !/^[a-z0-9]{20}$/.test(expectedProjectRef)) throw new Error(usage);
  const rawBatchSize = values.get("--batch-size");
  if (rawBatchSize !== undefined && !/^[1-9]\d*$/.test(rawBatchSize)) throw new Error(usage);
  const batchSize = rawBatchSize === undefined ? defaultSongPublicIdBatchSize : Number(rawBatchSize);
  if (!Number.isSafeInteger(batchSize) || batchSize > maximumSongPublicIdBatchSize) {
    throw new Error(`Batch size must be between 1 and ${maximumSongPublicIdBatchSize}.`);
  }
  return { batchSize, expectedProjectRef };
}

export function assertSongPublicIdBackfillTarget(databaseUrl: string, expectedProjectRef: string): void {
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("DIRECT_URL is not a valid database URL.");
  }
  const isPooler = target.hostname.endsWith(".pooler.supabase.com") &&
    target.username === `postgres.${expectedProjectRef}`;
  const isDirect = target.hostname === `db.${expectedProjectRef}.supabase.co` &&
    target.username === "postgres";
  if (!(["postgres:", "postgresql:"].includes(target.protocol) &&
    target.pathname === "/postgres" && (target.port === "" || target.port === "5432") &&
    (isPooler || isDirect))) {
    throw new Error("DIRECT_URL does not match the explicitly expected Supabase project.");
  }
}

async function main() {
  config({ path: [".env.local", ".env"], quiet: true });
  const { batchSize, expectedProjectRef } = parseArguments(process.argv.slice(2));
  const databaseUrl = requireAdminDatabaseUrl();
  assertSongPublicIdBackfillTarget(databaseUrl, expectedProjectRef);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 20, prepare: false });
  try {
    const result = await runSongPublicIdBackfill(sql, { batchSize });
    console.log(
      `processed=${result.processed} updated=${result.updated} remainingNull=${result.remainingNull} ` +
      `batches=${result.batches} retries=${result.retries} elapsedMs=${Math.round(result.elapsedMs)}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1]?.endsWith("backfill-song-public-id.ts")) {
  main().catch(() => {
    console.error("Song public ID backfill failed. Verify the phase A schema and local run logs.");
    process.exitCode = 1;
  });
}
