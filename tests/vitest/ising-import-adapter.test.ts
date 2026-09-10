import { describe, expect, it, vi } from "vitest";

import {
  classifyISingImportFailure,
  runISingImportAdapter,
  type ISingImportMode,
  type ISingImportOptions,
} from "@/db/ising-import-adapter";

describe("shared iSing import adapter", () => {
  it("writes bounded batches with monotonic checkpoint counters", async () => {
    const batchSizes: number[] = [];
    const checkpoints: Array<{ phase: string; processed: number }> = [];
    const outcome = await runISingImportAdapter(
      options("write", { batchSize: 2 }),
      {
        nowFn: () => new Date("2026-07-16T12:00:00Z"),
        delayFn: async () => undefined,
        fetchFn: async () =>
          response(page([song(1), song(2), song(3)])),
        persistBatch: async (batch) => {
          batchSizes.push(batch.length);
          return batch.length === 2
            ? { inserted: 1, updated: 1 }
            : { inserted: 1, updated: 0 };
        },
        checkpoint: async ({ phase, progress }) => {
          checkpoints.push({ phase, processed: progress.processed });
          return "continue";
        },
      },
    );

    expect(outcome).toEqual({
      status: "completed",
      summary: {
        processed: 3,
        inserted: 2,
        updated: 1,
        skipped: 0,
        errors: 0,
        pages: 1,
        mode: "write",
      },
    });
    expect(batchSizes).toEqual([2, 1]);
    expect(checkpoints).toEqual([
      { phase: "before_page", processed: 0 },
      { phase: "before_batch", processed: 0 },
      { phase: "after_batch", processed: 2 },
      { phase: "before_batch", processed: 2 },
      { phase: "after_batch", processed: 3 },
    ]);
  });

  it.each(["dry_run", "validate"] as const)(
    "%s maps and counts without writing songs",
    async (mode) => {
      const persistBatch = vi.fn(async () => ({ inserted: 1, updated: 0 }));
      const outcome = await runISingImportAdapter(options(mode), {
        delayFn: async () => undefined,
        fetchFn: async () => response(page([song(1)])),
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
      expect(persistBatch).not.toHaveBeenCalled();
    },
  );

  it("stops before the next page after cooperative cancellation", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(page([song(1)], "https://api.ising.pl/v2/search?page=2")),
      )
      .mockResolvedValueOnce(response(page([song(2)])));
    let completedBatches = 0;
    const outcome = await runISingImportAdapter(
      options("write", { batchSize: 1 }),
      {
        delayFn: async () => undefined,
        fetchFn,
        persistBatch: async () => ({ inserted: 1, updated: 0 }),
        checkpoint: async ({ phase }) => {
          if (phase === "after_batch") completedBatches += 1;
          if (phase === "before_page" && completedBatches === 1) {
            return "cancelled";
          }
          return "continue";
        },
      },
    );

    expect(outcome.status).toBe("cancelled");
    expect(outcome.summary.processed).toBe(1);
    expect(fetchFn).toHaveBeenCalledOnce();
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

  it("classifies nested infrastructure failures without exposing their cause", () => {
    const secret = "test-only-connection-detail";
    const failure = classifyISingImportFailure(
      new Error("adapter wrapper", {
        cause: Object.assign(new Error(secret), { code: "08003" }),
      }),
    );

    expect(failure.kind).toBe("transient");
    expect(JSON.stringify(failure)).not.toContain(secret);
  });
});

function options(
  mode: ISingImportMode,
  overrides: Partial<ISingImportOptions> = {},
): ISingImportOptions {
  return {
    apiBaseUrl: "https://api.ising.pl/v2",
    clientId: "test-client",
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

function song(id: number) {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    duration: 180,
    genre: ["Pop"],
    languages: ["Polish"],
    plus: false,
    hit: false,
  };
}

function page(songs: unknown[], next?: string) {
  return {
    data: { found: songs.length, q: "", results: { songs } },
    links: next ? { next } : {},
  };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
