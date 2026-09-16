import { describe, expect, it, vi } from "vitest";

import {
  buildISingInitialSearchUrl,
  ISingHttpError,
  ISingImportSafetyError,
  readAndValidateISingResponse,
  resolveISingNextUrl,
} from "@/db/ising-client";
import {
  mapISingSongToSong,
  type ISingApiSong,
} from "@/db/ising-mapping";
import {
  classifyISingImportFailure,
  createISingMetadataEnrichment,
  runISingImportAdapter,
  type ISingImportMode,
  type ISingImportOptions,
} from "@/db/ising-import-adapter";

describe("shared iSing import adapter", () => {
  it("collects complete memberships before writing bounded enriched batches", async () => {
    const persisted: Array<ReadonlyArray<ReturnType<typeof mappedSong>>> = [];
    const checkpoints: Array<{ phase: string; processed: number }> = [];
    const outcome = await runISingImportAdapter(options("write", { batchSize: 2 }), {
      nowFn: () => new Date("2026-08-18T12:00:00Z"),
      delayFn: async () => undefined,
      fetchFn: fetchFor({
        base: [song(1), song(2), song(3)],
        "lang:pl": [song(1), song(3)],
        "lang:-pl": [song(2)],
        "tag:duet": [song(2)],
      }),
      persistBatch: async (batch) => {
        persisted.push(batch as ReadonlyArray<ReturnType<typeof mappedSong>>);
        return { inserted: batch.length, updated: 0 };
      },
      checkpoint: async ({ phase, progress }) => {
        checkpoints.push({ phase, processed: progress.processed });
        return "continue";
      },
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.summary).toEqual({
      processed: 3,
      inserted: 3,
      updated: 0,
      skipped: 0,
      errors: 0,
      pages: 1,
      mode: "write",
    });
    expect(outcome.diagnostics).toMatchObject({
      enrichmentStatus: "complete",
      requestCount: 4,
      baseCatalog: { sourceSongIds: 3, complete: true },
      coverage: {
        canonicalLanguageSourceSongIds: 2,
        unmatchedCanonicalLanguageSourceSongIds: 1,
        allLanguageFilterSourceSongIds: 3,
        sourceSongIdsOutsideLanguageFilters: 0,
      },
      duetMembership: { sourceSongIds: 1 },
      mappedMetadata: {
        validMappedSongs: 3,
        songsWithLanguages: 2,
        duetSongs: 1,
      },
    });
    expect(persisted.map((batch) => batch.length)).toEqual([2, 1]);
    expect(persisted.flat().map((song) => ({
      id: song.sourceSongId,
      languages: song.languages,
      isDuet: song.isDuet,
    }))).toEqual([
      { id: "1", languages: ["Polish"], isDuet: false },
      { id: "2", languages: [], isDuet: true },
      { id: "3", languages: ["Polish"], isDuet: false },
    ]);
    expect(checkpoints.slice(0, 4)).toEqual([
      { phase: "before_page", processed: 0 },
      { phase: "before_page", processed: 0 },
      { phase: "before_page", processed: 0 },
      { phase: "before_page", processed: 0 },
    ]);
  });

  it.each(["dry_run", "validate"] as const)(
    "%s maps complete enrichment without writing songs",
    async (mode) => {
      const persistBatch = vi.fn(async () => ({ inserted: 1, updated: 0 }));
      const outcome = await runISingImportAdapter(options(mode), {
        delayFn: async () => undefined,
        fetchFn: fetchFor({
          base: [song(1)],
          "lang:pl": [song(1)],
          "lang:-pl": [],
          "tag:duet": [],
        }),
        persistBatch,
      });

      expect(outcome.status).toBe("completed");
      expect(outcome.summary).toMatchObject({
        processed: 1,
        inserted: 1,
        updated: 0,
        skipped: 0,
        mode,
      });
      expect(outcome.diagnostics?.mappedMetadata).toMatchObject({
        songsWithLanguages: 1,
        duetSongs: 0,
      });
      expect(persistBatch).not.toHaveBeenCalled();
    },
  );

  it("does not write or clear metadata when a required membership run is incomplete", async () => {
    const persistBatch = vi.fn(async () => ({ inserted: 1, updated: 0 }));
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("lang") === "pl") {
        return new Response("rate limited", { status: 429 });
      }
      return response(page([song(1)], 1));
    });

    await expect(
      runISingImportAdapter(options("write"), {
        delayFn: async () => undefined,
        fetchFn,
        persistBatch,
      }),
    ).rejects.toMatchObject({ name: "ISingImportSafetyError" });
    expect(persistBatch).not.toHaveBeenCalled();
  });

  it("fails closed before writing when a membership page stream repeats a song id", async () => {
    const persistBatch = vi.fn(async () => ({ inserted: 1, updated: 0 }));

    await expect(
      runISingImportAdapter(options("write"), {
        delayFn: async () => undefined,
        fetchFn: fetchFor({
          base: [song(1), song(2)],
          "lang:pl": [song(1), song(1)],
          "lang:-pl": [song(2)],
          "tag:duet": [],
        }),
        persistBatch,
      }),
    ).rejects.toMatchObject({ name: "ISingImportSafetyError" });

    expect(persistBatch).not.toHaveBeenCalled();
  });

  it("fails closed before writing when a membership row lacks a stable song id", async () => {
    const persistBatch = vi.fn(async () => ({ inserted: 1, updated: 0 }));

    await expect(
      runISingImportAdapter(options("write"), {
        delayFn: async () => undefined,
        fetchFn: fetchFor({
          base: [song(1)],
          "lang:pl": [{ ...song(1), id: null }],
          "lang:-pl": [],
          "tag:duet": [],
        }),
        persistBatch,
      }),
    ).rejects.toMatchObject({ name: "ISingImportSafetyError" });

    expect(persistBatch).not.toHaveBeenCalled();
  });

  it("stops before enrichment writes when the worker cancels during collection", async () => {
    const persistBatch = vi.fn(async () => ({ inserted: 1, updated: 0 }));
    let beforePageCalls = 0;
    const outcome = await runISingImportAdapter(options("write"), {
      delayFn: async () => undefined,
      fetchFn: fetchFor({
        base: [song(1)],
        "lang:pl": [song(1)],
        "lang:-pl": [],
        "tag:duet": [],
      }),
      persistBatch,
      checkpoint: async ({ phase }) => {
        if (phase === "before_page") {
          beforePageCalls += 1;
          return beforePageCalls === 2 ? "cancelled" : "continue";
        }
        return "continue";
      },
    });

    expect(outcome).toEqual({
      status: "cancelled",
      summary: {
        processed: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        pages: 1,
        mode: "write",
      },
    });
    expect(persistBatch).not.toHaveBeenCalled();
  });

  it("paces every request across pages and all four streams", async () => {
    let elapsed = 0;
    const requests: Array<{ stream: string; start: string | null; at: number }> = [];
    const source = fetchFor({
      base: Array.from({ length: 51 }, (_, index) => song(index + 1)),
      "lang:pl": Array.from({ length: 51 }, (_, index) => song(index + 1)),
      "lang:-pl": [],
      "tag:duet": [],
    });
    const outcome = await runISingImportAdapter(
      options("dry_run", { delayMs: 3_000 }),
      {
        delayFn: async (milliseconds) => { elapsed += milliseconds; },
        fetchFn: async (input, init) => {
          const url = new URL(String(input));
          requests.push({
            stream: url.searchParams.get("lang") || url.searchParams.get("tag") || "base",
            start: url.searchParams.get("start"),
            at: elapsed,
          });
          return source(input, init);
        },
      },
    );

    expect(outcome.status).toBe("completed");
    expect(requests).toEqual([
      { stream: "base", start: null, at: 0 },
      { stream: "base", start: "50", at: 3_000 },
      { stream: "pl", start: null, at: 6_000 },
      { stream: "pl", start: "50", at: 9_000 },
      { stream: "-pl", start: null, at: 12_000 },
      { stream: "duet", start: null, at: 15_000 },
    ]);
  });

  it("cancels during a paced wait before the next HTTP request", async () => {
    const fetchFn = fetchFor({ base: [song(1)], "lang:pl": [song(1)] });
    const persistBatch = vi.fn(async () => ({ inserted: 1, updated: 0 }));
    let checkpoints = 0;
    const outcome = await runISingImportAdapter(
      options("write", { delayMs: 3_000 }),
      {
        fetchFn,
        delayFn: async () => undefined,
        persistBatch,
        checkpoint: async () => (++checkpoints === 3 ? "cancelled" : "continue"),
      },
    );

    expect(outcome.status).toBe("cancelled");
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(persistBatch).not.toHaveBeenCalled();
  });

  it("retries 429 with Retry-After seconds and succeeds within three attempts", async () => {
    const source = fetchFor({ base: [song(1)], "lang:pl": [song(1)] });
    const waits: number[] = [];
    let elapsed = 0;
    const baseAttemptTimes: number[] = [];
    let attempts = 0;
    const outcome = await runISingImportAdapter(
      options("dry_run", { delayMs: 1_000 }),
      {
        delayFn: async (milliseconds) => {
          waits.push(milliseconds);
          elapsed += milliseconds;
        },
        fetchFn: async (input, init) => {
          const url = new URL(String(input));
          if (!url.searchParams.get("lang") && !url.searchParams.get("tag")) {
            baseAttemptTimes.push(elapsed);
            if (++attempts === 1) {
              return new Response("rate limited", {
                status: 429,
                headers: { "retry-after": "5" },
              });
            }
          }
          return source(input, init);
        },
      },
    );

    expect(outcome.status).toBe("completed");
    expect(outcome.diagnostics?.requestCount).toBe(5);
    expect(attempts).toBe(2);
    expect(baseAttemptTimes).toEqual([0, 5_000]);
    expect(waits.slice(0, 5)).toEqual([1_000, 1_000, 1_000, 1_000, 1_000]);
  });

  it("exhausts request retries after three 429s without writing", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("rate limited", { status: 429 }));
    const persistBatch = vi.fn(async () => ({ inserted: 1, updated: 0 }));
    const waits: number[] = [];
    await expect(runISingImportAdapter(options("write"), {
      delayFn: async (milliseconds) => { waits.push(milliseconds); },
      fetchFn,
      persistBatch,
    })).rejects.toBeInstanceOf(ISingHttpError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(waits.reduce((sum, value) => sum + value, 0)).toBe(9_000);
    expect(persistBatch).not.toHaveBeenCalled();
  });

  it("retries a transient 5xx response and checks cancellation during backoff", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("temporarily unavailable", { status: 503 }));
    let checkpoints = 0;
    const outcome = await runISingImportAdapter(options("write"), {
      fetchFn,
      delayFn: async () => undefined,
      persistBatch: async () => ({ inserted: 1, updated: 0 }),
      checkpoint: async () => (++checkpoints === 3 ? "cancelled" : "continue"),
    });
    expect(outcome.status).toBe("cancelled");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("does not retry permanent 4xx and keeps the client ID out of errors", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("bad request", { status: 400 }));
    let failure: unknown;
    try {
      await runISingImportAdapter(options("dry_run"), {
        delayFn: async () => undefined,
        fetchFn,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ISingHttpError);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(JSON.stringify(failure)).not.toContain("test-client-id");
    expect(classifyISingImportFailure(failure).kind).toBe("terminal");
  });

  it("parses HTTP-date Retry-After and refuses waits beyond the one-minute request cap", async () => {
    const now = Date.parse("2026-08-18T12:00:00Z");
    await expect(readAndValidateISingResponse(
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "Tue, 18 Aug 2026 12:00:10 GMT" },
      }),
      "https://api.ising.pl/v2/search?client_id=test-client-id",
      now,
    )).rejects.toMatchObject({ retryAfterMs: 10_000 });

    const fetchFn = vi.fn<typeof fetch>(async () => new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "120" },
    }));
    await expect(runISingImportAdapter(options("dry_run"), {
      delayFn: async () => undefined,
      fetchFn,
    })).rejects.toBeInstanceOf(ISingHttpError);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("uses typed tag/lang URLs, follows only same-origin pagination, and redacts credentials from errors", () => {
    const initial = new URL(
      buildISingInitialSearchUrl({
        apiBaseUrl: "https://api.ising.pl/v2",
        clientId: "test-client-id",
        tag: "duet",
        lang: "pl",
        order: "-artist_string",
        timeoutMs: 1_000,
      }),
    );
    expect(Object.fromEntries(initial.searchParams)).toMatchObject({
      q: "",
      tag: "duet",
      lang: "pl",
      limit: "50",
      order: "-artist_string",
      scope: "songs",
    });
    expect(initial.searchParams.get("per_page")).toBeNull();

    const next = new URL(
      resolveISingNextUrl(
        "/v2/search?scope=songs&start=50",
        { apiBaseUrl: "https://api.ising.pl/v2", clientId: "test-client-id" },
      ),
    );
    expect(next.searchParams.get("start")).toBe("50");
    expect(next.searchParams.get("client_id")).toBe("test-client-id");

    expect(() =>
      resolveISingNextUrl("https://example.test/search", {
        apiBaseUrl: "https://api.ising.pl/v2",
        clientId: "test-client-id",
      }),
    ).toThrow(ISingImportSafetyError);
    const error = new ISingImportSafetyError(
      "test",
      initial.toString(),
    );
    expect(error.url).not.toContain("test-client-id");
    expect(error.url).toBe("https://api.ising.pl/v2/search");
  });

  it("creates deterministic, idempotent multi-language and duet enrichment", () => {
    const enrichment = createISingMetadataEnrichment(
      [
        { canonicalLanguage: "Polish", sourceSongIds: ["1", "1", "2"] },
        { canonicalLanguage: "English", sourceSongIds: ["1"] },
      ],
      ["2", "2"],
    );

    expect(mapISingSongToSong(song(1), checkedAt, enrichment)).toMatchObject({
      languages: ["English", "Polish"],
      isDuet: false,
    });
    expect(mapISingSongToSong(song(2), checkedAt, enrichment)).toMatchObject({
      languages: ["Polish"],
      isDuet: true,
    });
    expect(
      createISingMetadataEnrichment(
        [{ canonicalLanguage: "Polish", sourceSongIds: ["1", "1", "2"] }],
        ["2", "2"],
      ),
    ).toEqual(
      createISingMetadataEnrichment(
        [{ canonicalLanguage: "Polish", sourceSongIds: ["1", "2"] }],
        ["2"],
      ),
    );
  });

  it("keeps language metadata empty for filter members and unclassified base songs", async () => {
    const persisted: Array<ReadonlyArray<ReturnType<typeof mappedSong>>> = [];
    const outcome = await runISingImportAdapter(options("write"), {
      delayFn: async () => undefined,
      fetchFn: fetchFor({
        base: [song(1), song(2)],
        "lang:pl": [],
        "lang:-pl": [song(1)],
        "tag:duet": [],
      }),
      persistBatch: async (batch) => {
        persisted.push(batch as ReadonlyArray<ReturnType<typeof mappedSong>>);
        return { inserted: batch.length, updated: 0 };
      },
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.diagnostics?.enrichmentStatus).toBe("complete");
    expect(outcome.diagnostics?.coverage).toMatchObject({
      allLanguageFilterSourceSongIds: 1,
      sourceSongIdsOutsideLanguageFilters: 1,
    });
    expect(persisted.flat()).toMatchObject([
      { sourceSongId: "1", languages: [], isDuet: false },
      { sourceSongId: "2", languages: [], isDuet: false },
    ]);
  });

  it("maps only confirmed base payload fields and ignores fake language/duet claims", () => {
    const mapped = mapISingSongToSong(
      {
        ...song(9),
        genre: ["pop", "rock"],
        duration: 245,
        hit: true,
        plus: true,
        language: "Pretend Polish",
        languages: ["Pretend Polish"],
        duet: true,
        is_duet: true,
      },
      checkedAt,
    );

    expect(mapped).toMatchObject({
      sourceSongId: "9",
      genres: ["pop", "rock"],
      durationSeconds: 245,
      isHit: true,
      isPlus: true,
      languages: [],
      isDuet: false,
      isExplicit: false,
    });
  });

  it("updates existing songs and inserts new ones without duplicate source IDs", async () => {
    const persisted = new Map<string, ReturnType<typeof mappedSong>>([
      ["1", mappedSong("1", [], false)],
    ]);
    const outcome = await runISingImportAdapter(options("write"), {
      nowFn: () => checkedAt,
      delayFn: async () => undefined,
      fetchFn: fetchFor({
        base: [song(1), song(2), song(2)],
        "lang:pl": [song(1)],
        "lang:-pl": [song(2)],
        "tag:duet": [song(2)],
      }),
      persistBatch: async (batch) => {
        let inserted = 0;
        let updated = 0;
        for (const current of batch) {
          if (persisted.has(current.sourceSongId)) updated += 1;
          else inserted += 1;
          persisted.set(current.sourceSongId, current as ReturnType<typeof mappedSong>);
        }
        return { inserted, updated };
      },
    });

    expect(outcome.summary).toMatchObject({
      processed: 3,
      inserted: 1,
      updated: 1,
      skipped: 1,
    });
    expect(Array.from(persisted.keys())).toEqual(["1", "2"]);
    expect(persisted.get("1")).toMatchObject({ languages: ["Polish"] });
    expect(persisted.get("2")).toMatchObject({ isDuet: true });
  });

  it("keeps persisted failure data constant and free of raw errors", () => {
    const secret = "test-only-secret";
    const transient = classifyISingImportFailure(
      new TypeError(`network failed with ${secret}`),
    );
    const terminal = classifyISingImportFailure(
      new Error(`invalid payload with ${secret}`),
    );

    expect(transient.kind).toBe("transient");
    expect(terminal.kind).toBe("terminal");
    expect(JSON.stringify([transient, terminal])).not.toContain(secret);
  });

  it("returns a retry-safe result for an iSing rate-limit response", () => {
    expect(
      classifyISingImportFailure(
        new ISingImportSafetyError(
          "HTTP 429 rate limit from iSing",
          "https://api.ising.pl/v2/search?client_id=test-client-id",
        ),
      ),
    ).toEqual({
      kind: "transient",
      safeErrorCode: "ISING_TEMPORARILY_UNAVAILABLE",
      safeErrorSummary: "The iSing source is temporarily unavailable.",
    });
  });

  it.each([
    "40001",
    "40P01",
    "08006",
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
  ])("classifies infrastructure code %s as transient", (code) => {
    const error = Object.assign(new Error("sensitive infrastructure detail"), {
      code,
    });

    expect(classifyISingImportFailure(error)).toEqual({
      kind: "transient",
      safeErrorCode: "ISING_TEMPORARILY_UNAVAILABLE",
      safeErrorSummary: "The iSing source is temporarily unavailable.",
    });
  });
});

const checkedAt = new Date("2026-08-18T12:00:00.000Z");

function options(
  mode: ISingImportMode,
  overrides: Partial<ISingImportOptions> = {},
): ISingImportOptions {
  return {
    apiBaseUrl: "https://api.ising.pl/v2",
    clientId: "test-client-id",
    delayMs: 0,
    tag: "",
    order: "-artist_string",
    limit: null,
    mode,
    batchSize: 10,
    timeoutMs: 1_000,
    ...overrides,
  };
}

function song(id: number): ISingApiSong {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    duration: 180,
    genre: ["Pop"],
    plus: false,
    hit: false,
    permalink: `https://ising.pl/song-${id}`,
  };
}

function mappedSong(sourceSongId: string, languages: string[], isDuet: boolean) {
  return {
    source: "ising" as const,
    sourceSongId,
    title: `Song ${sourceSongId}`,
    artist: `Artist ${sourceSongId}`,
    normalizedTitle: `song ${sourceSongId}`,
    normalizedArtist: `artist ${sourceSongId}`,
    searchText: `artist ${sourceSongId} song ${sourceSongId}`,
    durationSeconds: 180,
    genres: ["Pop"],
    languages,
    isDuet,
    isExplicit: false,
    isPlus: false,
    isHit: false,
    sourceUrl: `https://ising.pl/song-${sourceSongId}`,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt,
    createdAt: checkedAt,
    updatedAt: checkedAt,
  };
}

function fetchFor(collections: Record<string, readonly unknown[]>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const key = url.searchParams.get("lang")
      ? `lang:${url.searchParams.get("lang")}`
      : url.searchParams.get("tag")
        ? `tag:${url.searchParams.get("tag")}`
        : "base";
    const all = collections[key] ?? [];
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const start = Number(url.searchParams.get("start") ?? "0");
    const pageRows = all.slice(start, start + limit);
    const next = start + pageRows.length < all.length ? new URL(url) : null;
    if (next) next.searchParams.set("start", String(start + pageRows.length));
    return response(page(pageRows, all.length, next?.toString()));
  });
}

function page(songs: readonly unknown[], found: number, next?: string) {
  return {
    data: { found, q: "", results: { songs } },
    links: next ? { next } : {},
  };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
