import { config } from "dotenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  buildISingInitialSearchUrl,
  fetchISingSearchPage,
  resolveISingNextUrl,
  type ISingClientOptions,
} from "./ising-client.ts";
import {
  mapISingSongToSong,
  type ISingSongPayload,
} from "./ising-mapping.ts";
import { getErrorMessage, logDatabaseError } from "./log-db-error.ts";
import { importJobs, songs } from "./schema.ts";

const DEFAULT_API_BASE_URL = "https://api.ising.pl/v2";
const DEFAULT_DELAY_MS = 3_000;
const DEFAULT_ORDER = "-artist_string";
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export type ISingImportOptions = {
  apiBaseUrl: string;
  clientId: string;
  delayMs: number;
  tag: string;
  order: string;
  limit: number | null;
  dryRun: boolean;
  batchSize: number;
  timeoutMs: number;
  userAgent?: string;
};

export type ISingImportSummary = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  pages: number;
  dryRun: boolean;
};

type ImportDependencies = {
  fetchFn?: typeof fetch;
  delayFn?: (ms: number) => Promise<void>;
  nowFn?: () => Date;
  persistBatchFn?: (
    batch: ISingSongPayload[],
  ) => Promise<{ inserted: number; updated: number }>;
};

config({ path: [".env.local", ".env"], quiet: true });

export function loadISingImportOptions(
  env: NodeJS.ProcessEnv,
  args: string[],
): ISingImportOptions {
  const cliOptions = parseCliOptions(args);
  const clientId = requiredEnv(env.ISING_CLIENT_ID, "ISING_CLIENT_ID");

  return {
    apiBaseUrl: nonEmpty(env.ISING_API_BASE_URL) ?? DEFAULT_API_BASE_URL,
    clientId,
    delayMs:
      cliOptions.delayMs ??
      parseNonNegativeInteger(
        env.ISING_IMPORT_DELAY_MS,
        "ISING_IMPORT_DELAY_MS",
        DEFAULT_DELAY_MS,
      ),
    tag: cliOptions.tag ?? env.ISING_IMPORT_TAG ?? "",
    order: cliOptions.order ?? env.ISING_IMPORT_ORDER ?? DEFAULT_ORDER,
    limit:
      cliOptions.limit ??
      parseOptionalPositiveInteger(env.ISING_IMPORT_LIMIT, "ISING_IMPORT_LIMIT"),
    dryRun: cliOptions.dryRun,
    batchSize: cliOptions.batchSize ?? DEFAULT_BATCH_SIZE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    userAgent: nonEmpty(env.ISING_IMPORT_USER_AGENT),
  };
}

export async function runISingImport(
  options: ISingImportOptions,
  dependencies: ImportDependencies = {},
) {
  const summary: ISingImportSummary = {
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    pages: 0,
    dryRun: options.dryRun,
  };
  const seenSourceSongIds = new Set<string>();
  const checkedAt = dependencies.nowFn?.() ?? new Date();
  const delayFn = dependencies.delayFn ?? delay;
  const clientOptions: ISingClientOptions = {
    apiBaseUrl: options.apiBaseUrl,
    clientId: options.clientId,
    tag: options.tag,
    order: options.order,
    timeoutMs: options.timeoutMs,
    userAgent: options.userAgent,
    fetchFn: dependencies.fetchFn,
  };
  let nextUrl: string | null = buildISingInitialSearchUrl(clientOptions);
  let batch: ISingSongPayload[] = [];

  const flushBatch = async () => {
    if (batch.length === 0) {
      return;
    }

    if (options.dryRun) {
      batch = [];
      return;
    }

    if (!dependencies.persistBatchFn) {
      throw new Error("persistBatchFn is required when dryRun is false.");
    }

    const result = await dependencies.persistBatchFn(batch);
    summary.inserted += result.inserted;
    summary.updated += result.updated;
    batch = [];
  };

  while (nextUrl && !limitReached(summary, options.limit)) {
    const page = await fetchISingSearchPage(nextUrl, clientOptions);
    summary.pages += 1;

    for (const rawSong of page.data.results.songs) {
      if (limitReached(summary, options.limit)) {
        break;
      }

      summary.processed += 1;

      const song = mapISingSongToSong(rawSong, checkedAt);
      if (song === null) {
        summary.skipped += 1;
        continue;
      }

      if (seenSourceSongIds.has(song.sourceSongId)) {
        summary.skipped += 1;
        continue;
      }

      seenSourceSongIds.add(song.sourceSongId);
      batch.push(song);

      if (options.dryRun) {
        summary.inserted += 1;
        batch = [];
        continue;
      }

      if (batch.length >= options.batchSize) {
        await flushBatch();
      }
    }

    nextUrl =
      page.links?.next && !limitReached(summary, options.limit)
        ? resolveISingNextUrl(page.links.next, options.apiBaseUrl)
        : null;

    if (nextUrl) {
      await delayFn(options.delayMs);
    }
  }

  await flushBatch();
  return summary;
}

async function main() {
  const options = loadISingImportOptions(process.env, process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  const client = databaseUrl
    ? postgres(databaseUrl, {
        connect_timeout: 10,
        idle_timeout: 20,
        max: 1,
        prepare: false,
      })
    : null;

  if (!options.dryRun && client === null) {
    throw new Error("DATABASE_URL is not configured.");
  }

  let jobId: number | null = null;
  const db = client === null ? null : drizzle({ client });
  const persistBatch = async (batch: ISingSongPayload[]) => {
    if (db === null) {
      throw new Error("Database is not configured.");
    }

    const sourceSongIds = batch.map((song) => song.sourceSongId);
    const existingRows = await db
      .select({ sourceSongId: songs.sourceSongId })
      .from(songs)
      .where(
        and(eq(songs.source, "ising"), inArray(songs.sourceSongId, sourceSongIds)),
      );
    const existingIds = new Set(
      existingRows.flatMap((row) =>
        row.sourceSongId === null ? [] : [row.sourceSongId],
      ),
    );

    await db
      .insert(songs)
      .values(batch)
      .onConflictDoUpdate({
        target: [songs.source, songs.sourceSongId],
        targetWhere: sql.raw('"source_song_id" is not null'),
        set: {
          title: sql.raw('excluded."title"'),
          artist: sql.raw('excluded."artist"'),
          normalizedTitle: sql.raw('excluded."normalized_title"'),
          normalizedArtist: sql.raw('excluded."normalized_artist"'),
          searchText: sql.raw('excluded."search_text"'),
          durationSeconds: sql.raw('excluded."duration_seconds"'),
          genres: sql.raw('excluded."genres"'),
          languages: sql.raw('excluded."languages"'),
          isDuet: sql.raw('excluded."is_duet"'),
          isExplicit: sql.raw('excluded."is_explicit"'),
          isPlus: sql.raw('excluded."is_plus"'),
          isHit: sql.raw('excluded."is_hit"'),
          sourceUrl: sql.raw('excluded."source_url"'),
          lastSeenAt: sql.raw('excluded."last_seen_at"'),
          lastCheckedAt: sql.raw('excluded."last_checked_at"'),
          updatedAt: sql.raw('excluded."updated_at"'),
        },
      });

    return {
      inserted: batch.length - existingIds.size,
      updated: existingIds.size,
    };
  };

  try {
    if (db !== null && !options.dryRun) {
      const [job] = await db
        .insert(importJobs)
        .values({
          source: "ising",
          status: "running",
          totalRows: 0,
          importedCount: 0,
          skippedCount: 0,
        })
        .returning({ id: importJobs.id });
      jobId = job?.id ?? null;
    }

    const summary = await runISingImport(options, {
      persistBatchFn: persistBatch,
    });

    if (db !== null && jobId !== null) {
      await db
        .update(importJobs)
        .set({
          status: "done",
          totalRows: summary.processed,
          importedCount: summary.inserted + summary.updated,
          skippedCount: summary.skipped,
          finishedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId));
    }

    printSummary(summary);
  } catch (error) {
    if (db !== null && jobId !== null) {
      await db
        .update(importJobs)
        .set({
          status: "failed",
          error: getErrorMessage(error),
          finishedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId));
    }

    throw error;
  } finally {
    if (client !== null) {
      await client.end({ timeout: 5 });
    }
  }
}

function printSummary(summary: ISingImportSummary) {
  console.log("iSing import summary");
  console.log(`dryRun=${summary.dryRun}`);
  console.log(`pages=${summary.pages}`);
  console.log(`processed=${summary.processed}`);
  console.log(`inserted=${summary.inserted}`);
  console.log(`updated=${summary.updated}`);
  console.log(`skipped=${summary.skipped}`);
  console.log(`errors=${summary.errors}`);
}

function parseCliOptions(args: string[]) {
  let dryRun = false;
  let limit: number | null = null;
  let batchSize: number | null = null;
  let delayMs: number | null = null;
  let tag: string | null = null;
  let order: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--") {
      continue;
    }

    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (argument === "--limit") {
      limit = parseRequiredPositiveOption(args[index + 1], "--limit");
      index += 1;
      continue;
    }

    if (argument === "--batch-size") {
      batchSize = parseRequiredPositiveOption(args[index + 1], "--batch-size");
      if (batchSize > MAX_BATCH_SIZE) {
        throw new Error(`--batch-size must be at most ${MAX_BATCH_SIZE}.`);
      }
      index += 1;
      continue;
    }

    if (argument === "--delay-ms") {
      delayMs = parseRequiredNonNegativeOption(args[index + 1], "--delay-ms");
      index += 1;
      continue;
    }

    if (argument === "--tag") {
      tag = requireOptionValue(args[index + 1], "--tag");
      index += 1;
      continue;
    }

    if (argument === "--order") {
      order = requireOptionValue(args[index + 1], "--order");
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return { dryRun, limit, batchSize, delayMs, tag, order };
}

function requiredEnv(value: string | undefined, name: string) {
  const trimmed = value?.trim();

  if (!trimmed || trimmed === "replace_me") {
    throw new Error(`${name} is not configured.`);
  }

  return trimmed;
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseRequiredPositiveOption(value: string | undefined, name: string) {
  const optionValue = requireOptionValue(value, name);
  const parsed = Number(optionValue);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function parseRequiredNonNegativeOption(value: string | undefined, name: string) {
  const optionValue = requireOptionValue(value, name);
  const parsed = Number(optionValue);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function requireOptionValue(value: string | undefined, name: string) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function parseNonNegativeInteger(
  value: string | undefined,
  name: string,
  fallback: number,
) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function parseOptionalPositiveInteger(value: string | undefined, name: string) {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function limitReached(summary: ISingImportSummary, limit: number | null) {
  return limit !== null && summary.processed >= limit;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (process.argv[1]?.endsWith("import-ising.ts")) {
  main().catch((error: unknown) => {
    logDatabaseError("iSing import failed", error);
    process.exitCode = 1;
  });
}
