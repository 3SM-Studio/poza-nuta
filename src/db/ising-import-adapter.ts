import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  buildISingInitialSearchUrl,
  fetchISingSearchPage,
  ISingHttpError,
  ISingImportSafetyError,
  isRetryableISingRequestError,
  resolveISingNextUrl,
  type ISingClientOptions,
  type ISingSearchFilter,
  type ISingSearchResponse,
} from "./ising-client.ts";
import {
  getISingSourceSongId,
  mapISingSongToSong,
  type ISingMetadataEnrichment,
  type ISingSongPayload,
} from "./ising-mapping.ts";
import { songs } from "./schema.ts";

export const defaultISingApiBaseUrl = "https://api.ising.pl/v2";
export const defaultISingDelayMs = 3_000;
export const defaultISingOrder = "-artist_string";
export const defaultISingBatchSize = 250;
export const maximumISingBatchSize = 1_000;
export const defaultISingTimeoutMs = 15_000;
export const maximumISingRequestAttempts = 3;
export const maximumISingRetryWaitMs = 60_000;
const maximumInterruptibleWaitStepMs = 1_000;

export type ISingLanguageTaxonomyEntry = {
  code: string;
  iSingLabel: string;
  canonicalLanguage: string | null;
};

// The public iSing filters expose an explicit Polish membership and a separate
// non-Polish filter membership. Only the former is a canonical language value.
export const iSingLanguageTaxonomy: readonly ISingLanguageTaxonomyEntry[] = [
  { code: "pl", iSingLabel: "Polskie", canonicalLanguage: "Polish" },
  { code: "-pl", iSingLabel: "Zagraniczne", canonicalLanguage: null },
];

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
  // Retains the established meaning: pages from the base catalog fetch.
  pages: number;
  mode: ISingImportMode;
};

export type ISingCollectionDiagnostics = {
  found: number;
  pages: number;
  rows: number;
  sourceSongIds: number;
  duplicateSourceSongIds: number;
};

export type ISingImportDiagnostics = {
  enrichmentStatus: "complete";
  requestCount: number;
  baseCatalog: ISingCollectionDiagnostics & {
    complete: boolean;
    invalidRows: number;
  };
  languageFilters: Array<
    ISingCollectionDiagnostics & {
      code: string;
      iSingLabel: string;
      canonicalLanguage: string | null;
    }
  >;
  duetMembership: ISingCollectionDiagnostics;
  coverage: {
    baseSourceSongIds: number;
    canonicalLanguageSourceSongIds: number;
    unmatchedCanonicalLanguageSourceSongIds: number;
    multiLanguageSourceSongIds: number;
    allLanguageFilterSourceSongIds: number;
    sourceSongIdsOutsideLanguageFilters: number;
    overlappingLanguageFilterSourceSongIds: number;
  };
  mappedMetadata: {
    validMappedSongs: number;
    skippedSongs: number;
    songsWithLanguages: number;
    songsWithMultipleLanguages: number;
    duetSongs: number;
    hitSongs: number;
    plusSongs: number;
    durationPopulatedSongs: number;
    genresPopulatedSongs: number;
  };
};

export type ISingCheckpointPhase =
  | "before_page"
  | "before_batch"
  | "after_batch";

export type ISingCheckpointDecision = "continue" | "cancelled" | "stopped";

export type ISingImportOutcome = {
  status: "completed" | "cancelled" | "stopped";
  summary: ISingImportSummary;
  diagnostics?: ISingImportDiagnostics;
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

type ISingSearchCollection = {
  found: number;
  pages: number;
  rows: number;
  complete: boolean;
};

type ISingMembershipCollection = ISingSearchCollection & SourceSongIdIndex;

type ISingCollectionOutcome =
  | { status: "completed"; collection: ISingSearchCollection }
  | { status: "cancelled" | "stopped" };

type SourceSongIdIndex = {
  sourceSongIds: Set<string>;
  duplicateSourceSongIds: number;
  invalidRows: number;
};

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
  const runCheckpoint = async (phase: ISingCheckpointPhase) =>
    checkpoint({ phase, progress: { ...summary } });
  const requestPage = createISingRequestGate({
    delayMs: options.delayMs,
    delayFn,
    checkpoint: () => runCheckpoint("before_page"),
  });
  const collect = (
    filter: ISingSearchFilter,
    maxRows: number | null,
    onRows: (rows: readonly unknown[]) => void,
  ) => collectCompleteISingSearch(
    createISingClientOptions(options, filter, dependencies.fetchFn),
    { maxRows, onRows, requestPage: requestPage.fetchPage },
  );
  const baseRows: unknown[] = [];

  // No write batch is constructed until every filter below has completed.
  const baseOutcome = await collect(
    { tag: options.tag },
    options.limit,
    (rows) => baseRows.push(...rows),
  );
  if (baseOutcome.status !== "completed") {
    return { status: baseOutcome.status, summary };
  }
  const baseCatalog = baseOutcome.collection;
  summary.pages = baseCatalog.pages;

  const languageCollections: Array<{
    taxonomy: ISingLanguageTaxonomyEntry;
    collection: ISingMembershipCollection;
  }> = [];
  for (const taxonomy of iSingLanguageTaxonomy) {
    const languageOutcome = await collectMembership(
      collect,
      { lang: taxonomy.code },
      `language filter ${taxonomy.code}`,
      options.apiBaseUrl,
    );
    if (languageOutcome.status !== "completed") {
      return { status: languageOutcome.status, summary };
    }
    languageCollections.push({
      taxonomy,
      collection: languageOutcome.collection,
    });
  }

  const duetOutcome = await collectMembership(
    collect,
    { tag: "duet" },
    "duet filter",
    options.apiBaseUrl,
  );
  if (duetOutcome.status !== "completed") {
    return { status: duetOutcome.status, summary };
  }
  const canonicalLanguageMemberships = languageCollections.flatMap(
    ({ taxonomy, collection }) =>
      taxonomy.canonicalLanguage
        ? [
            {
              canonicalLanguage: taxonomy.canonicalLanguage,
              sourceSongIds: collection.sourceSongIds,
            },
          ]
        : [],
  );
  const enrichment = createISingMetadataEnrichment(
    canonicalLanguageMemberships,
    duetOutcome.collection.sourceSongIds,
  );
  const baseSourceSongIds = indexSourceSongIds(baseRows);
  const mapped = mapBaseCatalog(
    baseRows,
    enrichment,
    checkedAt,
  );
  const diagnostics = createImportDiagnostics({
    baseCatalog,
    baseSourceSongIds,
    languageCollections,
    duetCollection: duetOutcome.collection,
    enrichment,
    mapped,
    requestCount: requestPage.requestCount(),
  });

  let pendingSkipped = mapped.skipped;
  for (let offset = 0; offset < mapped.songs.length || pendingSkipped > 0; ) {
    const batch = mapped.songs.slice(offset, offset + options.batchSize);
    const decision = await flushMappedBatch({
      batch,
      pendingSkipped,
      mode: options.mode,
      persistBatch: dependencies.persistBatch,
      summary,
      checkpoint: runCheckpoint,
    });
    if (decision !== "continue") {
      return { status: decision, summary, diagnostics };
    }
    offset += batch.length;
    pendingSkipped = 0;
  }

  return { status: "completed", summary, diagnostics };
}

export function createISingMetadataEnrichment(
  languageMemberships: ReadonlyArray<{
    canonicalLanguage: string;
    sourceSongIds: Iterable<string>;
  }>,
  duetSourceSongIds: Iterable<string>,
): ISingMetadataEnrichment {
  const languagesBySourceSongId = new Map<string, Set<string>>();
  for (const membership of languageMemberships) {
    const canonicalLanguage = membership.canonicalLanguage.trim();
    if (!canonicalLanguage) continue;
    for (const sourceSongId of membership.sourceSongIds) {
      const normalizedSourceSongId = sourceSongId.trim();
      if (!normalizedSourceSongId) continue;
      const languages =
        languagesBySourceSongId.get(normalizedSourceSongId) ?? new Set<string>();
      languages.add(canonicalLanguage);
      languagesBySourceSongId.set(normalizedSourceSongId, languages);
    }
  }

  return {
    languagesBySourceSongId,
    duetSourceSongIds: new Set(
      Array.from(duetSourceSongIds, (sourceSongId) => sourceSongId.trim()).filter(
        Boolean,
      ),
    ),
  };
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

async function collectCompleteISingSearch(
  clientOptions: ISingClientOptions,
  input: {
    maxRows: number | null;
    onRows: (rows: readonly unknown[]) => void;
    requestPage: (
      url: string,
      options: ISingClientOptions,
    ) => Promise<
      | { status: "completed"; page: ISingSearchResponse }
      | { status: "cancelled" | "stopped" }
    >;
  },
): Promise<ISingCollectionOutcome> {
  let nextUrl: string | null = buildISingInitialSearchUrl(clientOptions);
  let found: number | null = null;
  let rowCount = 0;
  const seenPageReferences = new Set<string>();
  let pages = 0;

  while (nextUrl && !collectionLimitReached(rowCount, input.maxRows)) {
    const pageReference = toPaginationReference(nextUrl);
    if (seenPageReferences.has(pageReference)) {
      throw new ISingImportSafetyError(
        "Repeated iSing pagination URL",
        nextUrl,
      );
    }
    seenPageReferences.add(pageReference);

    const pageOutcome = await input.requestPage(nextUrl, clientOptions);
    if (pageOutcome.status !== "completed") return pageOutcome;
    const page = pageOutcome.page;
    const pageFound = requireFoundCount(page, nextUrl);
    if (found === null) {
      found = pageFound;
    } else if (found !== pageFound) {
      throw new ISingImportSafetyError(
        "iSing result count changed during pagination",
        nextUrl,
      );
    }
    if (page.data.results.songs.length === 0 && page.links?.next) {
      throw new ISingImportSafetyError(
        "Empty iSing page has a continuation link",
        nextUrl,
      );
    }

    pages += 1;
    const acceptedRows = input.maxRows === null
      ? page.data.results.songs
      : page.data.results.songs.slice(0, Math.max(0, input.maxRows - rowCount));
    input.onRows(acceptedRows);
    rowCount += acceptedRows.length;

    nextUrl =
      page.links?.next && !collectionLimitReached(rowCount, input.maxRows)
        ? resolveISingNextUrl(page.links.next, clientOptions)
        : null;
  }

  if (found === null) {
    throw new ISingImportSafetyError(
      "Invalid iSing response: missing data.found",
      buildISingInitialSearchUrl(clientOptions),
    );
  }
  const complete = input.maxRows === null;
  if (complete && rowCount !== found) {
    throw new ISingImportSafetyError(
      "iSing pagination did not return the expected number of rows",
      buildISingInitialSearchUrl(clientOptions),
    );
  }

  return {
    status: "completed",
    collection: { rows: rowCount, found, pages, complete },
  };
}

async function collectMembership(
  collect: (
    filter: ISingSearchFilter,
    maxRows: number | null,
    onRows: (rows: readonly unknown[]) => void,
  ) => Promise<ISingCollectionOutcome>,
  filter: ISingSearchFilter,
  label: string,
  apiBaseUrl: string,
): Promise<
  | { status: "completed"; collection: ISingMembershipCollection }
  | { status: "cancelled" | "stopped" }
> {
  const sourceSongIds = new Set<string>();
  let duplicateSourceSongIds = 0;
  let invalidRows = 0;
  const outcome = await collect(filter, null, (rows) => {
    for (const row of rows) {
      const sourceSongId = getISingSourceSongId(row);
      if (!sourceSongId) {
        invalidRows += 1;
      } else if (sourceSongIds.has(sourceSongId)) {
        duplicateSourceSongIds += 1;
      } else {
        sourceSongIds.add(sourceSongId);
      }
    }
  });
  if (outcome.status !== "completed") return outcome;
  if (invalidRows > 0 || duplicateSourceSongIds > 0) {
    throw new ISingImportSafetyError(
      `iSing ${label} has invalid or duplicate stable song ids`,
      `${apiBaseUrl.replace(/\/$/, "")}/search`,
    );
  }
  return {
    status: "completed",
    collection: {
      ...outcome.collection,
      sourceSongIds,
      duplicateSourceSongIds,
      invalidRows,
    },
  };
}

function createISingRequestGate(input: {
  delayMs: number;
  delayFn: (milliseconds: number) => Promise<void>;
  checkpoint: () => Promise<ISingCheckpointDecision>;
}) {
  let requestCount = 0;
  const wait = async (milliseconds: number) => {
    let remaining = milliseconds;
    while (remaining > 0) {
      const decision = await input.checkpoint();
      if (decision !== "continue") return decision;
      const step = Math.min(remaining, maximumInterruptibleWaitStepMs);
      await input.delayFn(step);
      remaining -= step;
    }
    return input.checkpoint();
  };

  return {
    requestCount: () => requestCount,
    fetchPage: async (
      url: string,
      options: ISingClientOptions,
    ): Promise<
      | { status: "completed"; page: ISingSearchResponse }
      | { status: "cancelled" | "stopped" }
    > => {
      let retryWaitMs = 0;
      for (let attempt = 1; attempt <= maximumISingRequestAttempts; attempt += 1) {
        const decision = requestCount === 0
          ? await input.checkpoint()
          : await wait(Math.max(input.delayMs, retryWaitMs));
        if (decision !== "continue") return { status: decision };
        requestCount += 1;
        try {
          return {
            status: "completed",
            page: await fetchISingSearchPage(url, options),
          };
        } catch (error) {
          if (
            attempt === maximumISingRequestAttempts ||
            !isRetryableISingRequestError(error)
          ) throw error;
          const retryAfterMs = error instanceof ISingHttpError
            ? error.retryAfterMs
            : null;
          if (retryAfterMs !== null && retryAfterMs > maximumISingRetryWaitMs) {
            throw error;
          }
          retryWaitMs = Math.max(
            retryAfterMs ?? 0,
            Math.max(defaultISingDelayMs, input.delayMs) * 2 ** (attempt - 1),
          );
          if (retryWaitMs > maximumISingRetryWaitMs) throw error;
        }
      }
      throw new Error("iSing request retry loop ended unexpectedly.");
    },
  };
}

function createISingClientOptions(
  options: ISingImportOptions,
  filter: ISingSearchFilter,
  fetchFn: typeof fetch | undefined,
): ISingClientOptions {
  return {
    apiBaseUrl: options.apiBaseUrl,
    clientId: options.clientId,
    tag: filter.tag ?? "",
    lang: filter.lang,
    order: options.order,
    timeoutMs: options.timeoutMs,
    userAgent: options.userAgent,
    fetchFn,
  };
}

function requireFoundCount(page: ISingSearchResponse, url: string): number {
  const found = page.data.found;
  if (
    typeof found !== "number" ||
    !Number.isSafeInteger(found) ||
    found < 0
  ) {
    throw new ISingImportSafetyError(
      "Invalid iSing response: data.found is not a non-negative integer",
      url,
    );
  }
  return found;
}

function collectionLimitReached(rowCount: number, maxRows: number | null) {
  return maxRows !== null && rowCount >= maxRows;
}

function toPaginationReference(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.delete("client_id");
  return parsed.toString();
}

function indexSourceSongIds(rows: readonly unknown[]): SourceSongIdIndex {
  const sourceSongIds = new Set<string>();
  let duplicateSourceSongIds = 0;
  let invalidRows = 0;

  for (const row of rows) {
    const sourceSongId = getISingSourceSongId(row);
    if (!sourceSongId) {
      invalidRows += 1;
      continue;
    }
    if (sourceSongIds.has(sourceSongId)) {
      duplicateSourceSongIds += 1;
      continue;
    }
    sourceSongIds.add(sourceSongId);
  }

  return { sourceSongIds, duplicateSourceSongIds, invalidRows };
}

function mapBaseCatalog(
  rows: readonly unknown[],
  enrichment: ISingMetadataEnrichment,
  checkedAt: Date,
) {
  const songs: ISingSongPayload[] = [];
  const seenSourceSongIds = new Set<string>();
  let skipped = 0;

  for (const row of rows) {
    const sourceSongId = getISingSourceSongId(row);
    if (!sourceSongId || seenSourceSongIds.has(sourceSongId)) {
      skipped += 1;
      continue;
    }

    const song = mapISingSongToSong(row, checkedAt, enrichment);
    if (song === null) {
      skipped += 1;
      continue;
    }

    seenSourceSongIds.add(song.sourceSongId);
    songs.push(song);
  }

  return { songs, skipped };
}

function createImportDiagnostics(input: {
  baseCatalog: ISingSearchCollection;
  baseSourceSongIds: SourceSongIdIndex;
  languageCollections: ReadonlyArray<{
    taxonomy: ISingLanguageTaxonomyEntry;
    collection: ISingMembershipCollection;
  }>;
  duetCollection: ISingMembershipCollection;
  enrichment: ISingMetadataEnrichment;
  mapped: { songs: readonly ISingSongPayload[]; skipped: number };
  requestCount: number;
}): ISingImportDiagnostics {
  const canonicalLanguageSourceSongIds = new Set(
    input.enrichment.languagesBySourceSongId.keys(),
  );
  const allLanguageFilterSourceSongIds = new Set<string>();
  const filterMembershipCounts = new Map<string, number>();
  for (const { collection } of input.languageCollections) {
    for (const sourceSongId of collection.sourceSongIds) {
      allLanguageFilterSourceSongIds.add(sourceSongId);
      filterMembershipCounts.set(
        sourceSongId,
        (filterMembershipCounts.get(sourceSongId) ?? 0) + 1,
      );
    }
  }

  const baseIds = input.baseSourceSongIds.sourceSongIds;
  const intersectBase = (sourceSongIds: ReadonlySet<string>) =>
    countSetIntersection(baseIds, sourceSongIds);
  const canonicalLanguageCount = intersectBase(canonicalLanguageSourceSongIds);
  const filterLanguageCount = intersectBase(allLanguageFilterSourceSongIds);

  return {
    enrichmentStatus: "complete",
    requestCount: input.requestCount,
    baseCatalog: {
      found: input.baseCatalog.found,
      pages: input.baseCatalog.pages,
      rows: input.baseCatalog.rows,
      sourceSongIds: baseIds.size,
      duplicateSourceSongIds: input.baseSourceSongIds.duplicateSourceSongIds,
      invalidRows: input.baseSourceSongIds.invalidRows,
      complete: input.baseCatalog.complete,
    },
    languageFilters: input.languageCollections.map(
      ({ taxonomy, collection }) => ({
        code: taxonomy.code,
        iSingLabel: taxonomy.iSingLabel,
        canonicalLanguage: taxonomy.canonicalLanguage,
        found: collection.found,
        pages: collection.pages,
        rows: collection.rows,
        sourceSongIds: collection.sourceSongIds.size,
        duplicateSourceSongIds: collection.duplicateSourceSongIds,
      }),
    ),
    duetMembership: {
      found: input.duetCollection.found,
      pages: input.duetCollection.pages,
      rows: input.duetCollection.rows,
      sourceSongIds: input.duetCollection.sourceSongIds.size,
      duplicateSourceSongIds: input.duetCollection.duplicateSourceSongIds,
    },
    coverage: {
      baseSourceSongIds: baseIds.size,
      canonicalLanguageSourceSongIds: canonicalLanguageCount,
      unmatchedCanonicalLanguageSourceSongIds:
        baseIds.size - canonicalLanguageCount,
      multiLanguageSourceSongIds: countSetValuesAtLeast(
        input.enrichment.languagesBySourceSongId,
        2,
        baseIds,
      ),
      allLanguageFilterSourceSongIds: filterLanguageCount,
      sourceSongIdsOutsideLanguageFilters: baseIds.size - filterLanguageCount,
      overlappingLanguageFilterSourceSongIds: countMembershipOverlap(
        filterMembershipCounts,
        baseIds,
      ),
    },
    mappedMetadata: {
      validMappedSongs: input.mapped.songs.length,
      skippedSongs: input.mapped.skipped,
      songsWithLanguages: input.mapped.songs.filter(
        (song) => song.languages.length > 0,
      ).length,
      songsWithMultipleLanguages: input.mapped.songs.filter(
        (song) => song.languages.length > 1,
      ).length,
      duetSongs: input.mapped.songs.filter((song) => song.isDuet).length,
      hitSongs: input.mapped.songs.filter((song) => song.isHit).length,
      plusSongs: input.mapped.songs.filter((song) => song.isPlus).length,
      durationPopulatedSongs: input.mapped.songs.filter(
        (song) => song.durationSeconds !== null,
      ).length,
      genresPopulatedSongs: input.mapped.songs.filter(
        (song) => song.genres.length > 0,
      ).length,
    },
  };
}

async function flushMappedBatch(input: {
  batch: readonly ISingSongPayload[];
  pendingSkipped: number;
  mode: ISingImportMode;
  persistBatch: ISingBatchWriter | undefined;
  summary: ISingImportSummary;
  checkpoint: (phase: ISingCheckpointPhase) => Promise<ISingCheckpointDecision>;
}) {
  if (input.batch.length === 0 && input.pendingSkipped === 0) {
    return "continue" as const;
  }

  const before = await input.checkpoint("before_batch");
  if (before !== "continue") return before;

  let result: ISingBatchResult;
  if (input.mode === "write") {
    result = await input.persistBatch!(input.batch);
    validateBatchResult(result, input.batch.length);
  } else {
    result = { inserted: input.batch.length, updated: 0 };
  }

  input.summary.processed += input.batch.length + input.pendingSkipped;
  input.summary.inserted += result.inserted;
  input.summary.updated += result.updated;
  input.summary.skipped += input.pendingSkipped;

  return input.checkpoint("after_batch");
}

function countSetIntersection(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
) {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function countSetValuesAtLeast(
  values: ReadonlyMap<string, ReadonlySet<string>>,
  minimum: number,
  baseSourceSongIds: ReadonlySet<string>,
) {
  let count = 0;
  for (const [sourceSongId, set] of values) {
    if (baseSourceSongIds.has(sourceSongId) && set.size >= minimum) count += 1;
  }
  return count;
}

function countMembershipOverlap(
  memberships: ReadonlyMap<string, number>,
  baseSourceSongIds: ReadonlySet<string>,
) {
  let count = 0;
  for (const [sourceSongId, membershipCount] of memberships) {
    if (baseSourceSongIds.has(sourceSongId) && membershipCount > 1) count += 1;
  }
  return count;
}

function validateOptions(options: ISingImportOptions): void {
  if (
    !isHttpUrl(options.apiBaseUrl) ||
    options.clientId.trim().length === 0 ||
    typeof options.tag !== "string" ||
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
