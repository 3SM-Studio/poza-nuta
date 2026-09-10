import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  buildISingInitialSearchUrl,
  fetchISingSearchPage,
  ISingImportSafetyError,
  resolveISingNextUrl,
  type ISingClientOptions,
} from "./ising-client.ts";
import {
  mapISingSongToSong,
  type ISingSongPayload,
} from "./ising-mapping.ts";
import { songs } from "./schema.ts";

export const defaultISingApiBaseUrl = "https://api.ising.pl/v2";
export const defaultISingDelayMs = 3_000;
export const defaultISingOrder = "-artist_string";
export const defaultISingBatchSize = 250;
export const maximumISingBatchSize = 1_000;
export const defaultISingTimeoutMs = 15_000;

export type ISingImportMode = "validate" | "dry_run" | "write";

export type ISingImportOptions = {
  apiBaseUrl: string;
  clientId: string;
  delayMs: number;
  tag: string;
  order: string;
  limit: number | null;
  mode: ISingImportMode;
  batchSize: number;
  timeoutMs: number;
  userAgent?: string;
};

export type ISingImportOverrides = Partial<
  Pick<ISingImportOptions, "batchSize" | "delayMs" | "limit" | "order" | "tag">
>;

export type ISingImportSummary = {
  processed: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  pages: number;
  mode: ISingImportMode;
};

export type ISingCheckpointPhase =
  | "before_page"
  | "before_batch"
  | "after_batch";

export type ISingCheckpointDecision = "continue" | "cancelled" | "stopped";

export type ISingImportOutcome = {
  status: "completed" | "cancelled" | "stopped";
  summary: ISingImportSummary;
};

export type ISingBatchResult = { inserted: number; updated: number };
export type ISingBatchWriter = (
  batch: readonly ISingSongPayload[],
) => Promise<ISingBatchResult>;

export type ISingImportDependencies = {
  fetchFn?: typeof fetch;
  delayFn?: (milliseconds: number) => Promise<void>;
  nowFn?: () => Date;
  persistBatch?: ISingBatchWriter;
  checkpoint?: (input: {
    phase: ISingCheckpointPhase;
    progress: ISingImportSummary;
  }) => Promise<ISingCheckpointDecision>;
};

export type SafeISingFailure = {
  kind: "transient" | "terminal";
  safeErrorCode: string;
  safeErrorSummary: string;
};

type SongDatabase = Pick<PostgresJsDatabase, "insert" | "select">;

export function loadISingAdapterOptions(
  env: NodeJS.ProcessEnv,
  mode: ISingImportMode,
  overrides: ISingImportOverrides = {},
): ISingImportOptions {
  const options = {
    apiBaseUrl: nonEmpty(env.ISING_API_BASE_URL) ?? defaultISingApiBaseUrl,
    clientId: requiredEnvironmentValue(env.ISING_CLIENT_ID, "ISING_CLIENT_ID"),
    delayMs:
      overrides.delayMs ??
      parseNonNegativeEnvironmentInteger(
        env.ISING_IMPORT_DELAY_MS,
        "ISING_IMPORT_DELAY_MS",
        defaultISingDelayMs,
      ),
    tag: overrides.tag ?? env.ISING_IMPORT_TAG ?? "",
    order: overrides.order ?? env.ISING_IMPORT_ORDER ?? defaultISingOrder,
    limit:
      overrides.limit ??
      parseOptionalPositiveEnvironmentInteger(
        env.ISING_IMPORT_LIMIT,
        "ISING_IMPORT_LIMIT",
      ),
    mode,
    batchSize: overrides.batchSize ?? defaultISingBatchSize,
    timeoutMs: defaultISingTimeoutMs,
    userAgent: nonEmpty(env.ISING_IMPORT_USER_AGENT),
  };

  validateOptions(options);
  return options;
}

export async function runISingImportAdapter(
  options: ISingImportOptions,
  dependencies: ISingImportDependencies = {},
): Promise<ISingImportOutcome> {
  validateOptions(options);
  if (options.mode === "write" && !dependencies.persistBatch) {
    throw new Error("The iSing write adapter requires a batch writer.");
  }

  const summary: ISingImportSummary = {
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    pages: 0,
    mode: options.mode,
  };
  const checkpoint = dependencies.checkpoint ?? (async () => "continue");
  const delayFn = dependencies.delayFn ?? delay;
  const checkedAt = dependencies.nowFn?.() ?? new Date();
  const seenSourceSongIds = new Set<string>();
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
  let pendingSkipped = 0;

  const runCheckpoint = async (phase: ISingCheckpointPhase) =>
    checkpoint({ phase, progress: { ...summary } });

  const flushBatch = async (): Promise<ISingCheckpointDecision> => {
    if (batch.length === 0 && pendingSkipped === 0) return "continue";

    const before = await runCheckpoint("before_batch");
    if (before !== "continue") return before;

    let result: ISingBatchResult;
    if (options.mode === "write") {
      result = await dependencies.persistBatch!(batch);
      validateBatchResult(result, batch.length);
    } else {
      result = { inserted: batch.length, updated: 0 };
    }

    summary.processed += batch.length + pendingSkipped;
    summary.inserted += result.inserted;
    summary.updated += result.updated;
    summary.skipped += pendingSkipped;
    batch = [];
    pendingSkipped = 0;

    return runCheckpoint("after_batch");
  };

  while (nextUrl && !limitReached(summary, batch, pendingSkipped, options.limit)) {
    const pageDecision = await runCheckpoint("before_page");
    if (pageDecision !== "continue") {
      return { status: pageDecision, summary };
    }

    const page = await fetchISingSearchPage(nextUrl, clientOptions);
    summary.pages += 1;

    for (const rawSong of page.data.results.songs) {
      if (limitReached(summary, batch, pendingSkipped, options.limit)) break;

      const song = mapISingSongToSong(rawSong, checkedAt);
      if (song === null || seenSourceSongIds.has(song.sourceSongId)) {
        pendingSkipped += 1;
      } else {
        seenSourceSongIds.add(song.sourceSongId);
        batch.push(song);
      }

      if (batch.length + pendingSkipped >= options.batchSize) {
        const decision = await flushBatch();
        if (decision !== "continue") {
          return { status: decision, summary };
        }
      }
    }

    nextUrl =
      page.links?.next &&
      !limitReached(summary, batch, pendingSkipped, options.limit)
        ? resolveISingNextUrl(page.links.next, options.apiBaseUrl)
        : null;

    if (nextUrl) await delayFn(options.delayMs);
  }

  const finalDecision = await flushBatch();
  if (finalDecision !== "continue") {
    return { status: finalDecision, summary };
  }
  return { status: "completed", summary };
}

export function createISingSongBatchWriter(
  database: SongDatabase,
): ISingBatchWriter {
  return async (batch) => {
    if (batch.length === 0) return { inserted: 0, updated: 0 };
    if (batch.length > maximumISingBatchSize) {
      throw new Error("The iSing batch exceeds the configured bound.");
    }

    const sourceSongIds = batch.map((song) => song.sourceSongId);
    const existingRows = await database
      .select({ sourceSongId: songs.sourceSongId })
      .from(songs)
      .where(
        and(
          eq(songs.source, "ising"),
          inArray(songs.sourceSongId, sourceSongIds),
        ),
      );
    const existingIds = new Set(
      existingRows.flatMap((row) =>
        row.sourceSongId === null ? [] : [row.sourceSongId],
      ),
    );

    await database
      .insert(songs)
      .values([...batch])
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
}

export function toImportJobProgress(summary: ISingImportSummary) {
  return {
    totalCount: summary.processed,
    processedCount: summary.processed,
    importedCount: summary.inserted + summary.updated,
    skippedCount: summary.skipped,
    errorCount: summary.errors,
  };
}

export function classifyISingImportFailure(error: unknown): SafeISingFailure {
  if (isTransientISingFailure(error)) {
    return {
      kind: "transient",
      safeErrorCode: "ISING_TEMPORARILY_UNAVAILABLE",
      safeErrorSummary: "The iSing source is temporarily unavailable.",
    };
  }
  return {
    kind: "terminal",
    safeErrorCode: "ISING_IMPORT_FAILED",
    safeErrorSummary: "The iSing import failed safe validation.",
  };
}

function validateOptions(options: ISingImportOptions): void {
  if (
    !isHttpUrl(options.apiBaseUrl) ||
    options.clientId.trim().length === 0 ||
    options.order.trim().length === 0 ||
    !Number.isSafeInteger(options.batchSize) ||
    options.batchSize <= 0 ||
    options.batchSize > maximumISingBatchSize ||
    !Number.isSafeInteger(options.delayMs) ||
    options.delayMs < 0 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    (options.limit !== null &&
      (!Number.isSafeInteger(options.limit) || options.limit <= 0))
  ) {
    throw new Error("The iSing adapter configuration is invalid.");
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validateBatchResult(result: ISingBatchResult, batchSize: number): void {
  if (
    !Number.isSafeInteger(result.inserted) ||
    result.inserted < 0 ||
    !Number.isSafeInteger(result.updated) ||
    result.updated < 0 ||
    result.inserted + result.updated !== batchSize
  ) {
    throw new Error("The iSing batch writer returned invalid counters.");
  }
}

function limitReached(
  summary: ISingImportSummary,
  batch: readonly ISingSongPayload[],
  pendingSkipped: number,
  limit: number | null,
) {
  return (
    limit !== null &&
    summary.processed + batch.length + pendingSkipped >= limit
  );
}

function isTransientISingFailure(error: unknown): boolean {
  let current = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (!(current instanceof Error)) return false;
    if (isTransientErrorInstance(current)) return true;
    current = current.cause;
  }

  return false;
}

const transientInfrastructureCodes = new Set([
  "40001",
  "40P01",
  "55P03",
  "57014",
  "57P01",
  "57P02",
  "57P03",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function isTransientErrorInstance(error: Error): boolean {
  if (error.name === "AbortError" || error instanceof TypeError) return true;

  const code = (error as Error & { code?: unknown }).code;
  if (
    typeof code === "string" &&
    (code.startsWith("08") || transientInfrastructureCodes.has(code))
  ) {
    return true;
  }

  if (/HTTP (403|408|425|429|5\d\d)\b/.test(error.message)) return true;
  return (
    error instanceof ISingImportSafetyError &&
    /HTTP (403|429)\b|verification|challenge/i.test(error.message)
  );
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function requiredEnvironmentValue(value: string | undefined, name: string) {
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

function parseNonNegativeEnvironmentInteger(
  value: string | undefined,
  name: string,
  fallback: number,
) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function parseOptionalPositiveEnvironmentInteger(
  value: string | undefined,
  name: string,
) {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
