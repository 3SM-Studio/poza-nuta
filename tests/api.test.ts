import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiServer, type ApiConfig } from "../apps/api/src/server.ts";
import { loadQueueState } from "../src/queue/localQueueStore.ts";
import { createLocalSongIndexCache, type LocalSongIndexCache } from "../src/search/cachedLocalSongIndex.ts";
import type { LocalSong } from "../src/songs/types.ts";

type TestApi = {
  baseUrl: string;
  config: ApiConfig;
  tempDir: string;
  logs: string[];
  errors: string[];
  request: (method: string, path: string, body?: unknown, token?: string) => Promise<ApiResponse>;
  close: () => Promise<void>;
};

type ApiResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
};

test("GET /health returns ok", async () => {
  const api = await startTestApi();
  try {
    const response = await api.request("GET", "/health");

    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.match(String(response.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
    assert.deepEqual(response.body, { ok: true });
  } finally {
    await cleanupApi(api);
  }
});

test("API logs access requests when API_LOG_LEVEL is info", async () => {
  const api = await startTestApi({ logLevel: "info" });
  try {
    const response = await api.request("GET", "/api/search?q=krolowa&limit=10");

    assert.equal(response.status, 200);
    assert.equal(api.logs.length, 1);
    assert.match(api.logs[0], /^\[api\] [0-9a-f-]{36} GET \/api\/search 200 \d+ms$/);
    assert.doesNotMatch(api.logs[0], /q=krolowa/);
  } finally {
    await cleanupApi(api);
  }
});

test("API does not log access requests when API_LOG_LEVEL is silent", async () => {
  const api = await startTestApi({ logLevel: "silent" });
  try {
    const response = await api.request("GET", "/health");

    assert.equal(response.status, 200);
    assert.deepEqual(api.logs, []);
    assert.deepEqual(api.errors, []);
  } finally {
    await cleanupApi(api);
  }
});

test("API logs do not include Authorization header or token values", async () => {
  const api = await startTestApi({ adminToken: "secret-token", logLevel: "info" });
  try {
    const response = await api.request("GET", "/api/events/test-event/operator-queue", undefined, "secret-token");
    const joinedLogs = [...api.logs, ...api.errors].join("\n");

    assert.equal(response.status, 404);
    assert.doesNotMatch(joinedLogs, /Authorization/i);
    assert.doesNotMatch(joinedLogs, /secret-token/);
  } finally {
    await cleanupApi(api);
  }
});

test("API error responses do not include stack traces", async () => {
  const api = await startTestApi();
  try {
    const response = await api.request("GET", "/api/events/bad!/public-queue");
    const serializedBody = JSON.stringify(response.body);

    assert.equal(response.status, 400);
    assert.equal(response.body.error, "bad_request");
    assert.doesNotMatch(serializedBody, /stack/i);
    assert.doesNotMatch(serializedBody, /at /);
  } finally {
    await cleanupApi(api);
  }
});

test("API error logs include requestId, method, path, status and message", async () => {
  const api = await startTestApi({ logLevel: "info" });
  try {
    const response = await api.request("GET", "/api/events/bad!/public-queue");
    const requestId = String(response.headers["x-request-id"]);

    assert.equal(response.status, 400);
    assert.equal(api.errors.length, 1);
    assert.match(api.errors[0], new RegExp(`^\\[api:error\\] ${requestId} GET /api/events/bad!/public-queue 400 Invalid event id$`));
  } finally {
    await cleanupApi(api);
  }
});

test("API responds to local Vite CORS preflight", async () => {
  const api = await startTestApi();
  try {
    const response = await requestJson(api.baseUrl, "OPTIONS", "/api/search", undefined, undefined, {
      origin: "http://127.0.0.1:5173",
      "access-control-request-method": "GET"
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
    assert.equal(response.headers["access-control-allow-methods"], "GET,POST,OPTIONS");
  } finally {
    await cleanupApi(api);
  }
});

test("GET /api/search?q=krolowa finds fixture song", async () => {
  const api = await startTestApi();
  try {
    const response = await api.request("GET", "/api/search?q=krolowa&limit=10");

    assert.equal(response.status, 200);
    assert.equal(response.body.query, "krolowa");
    assert.equal(response.body.results[0].title, "Królowa Łez");
    assert.equal(response.body.results[0].artist, "Agnieszka Chylińska");
  } finally {
    await cleanupApi(api);
  }
});

test("GET /api/search caps result limit and does not return a full dump", async () => {
  const api = await startTestApi({ songs: manyFixtureSongs(25) });
  try {
    const response = await api.request("GET", "/api/search?q=song&limit=999");

    assert.equal(response.status, 200);
    assert.equal(response.body.results.length, 20);
  } finally {
    await cleanupApi(api);
  }
});

test("GET /api/search does not perform external HTTP requests", async () => {
  const api = await startTestApi();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("API search must not call fetch");
  }) as typeof fetch;

  try {
    const response = await api.request("GET", "/api/search?q=krolowa");
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupApi(api);
  }
});

test("GET /api/search uses cached local song index between requests", async () => {
  let readCount = 0;
  const songIndex = createLocalSongIndexCache("cached-songs.json", {
    statFn: async () => ({ mtimeMs: 1, size: 100 }),
    readIndexFn: async () => {
      readCount += 1;
      return fixtureSongs();
    }
  });
  const api = await startTestApi({ writeSongIndex: false, songIndex });
  try {
    assert.equal((await api.request("GET", "/api/search?q=krolowa")).status, 200);
    assert.equal((await api.request("GET", "/api/search?q=queen")).status, 200);
    assert.equal(readCount, 1);
  } finally {
    await cleanupApi(api);
  }
});

test("GET /api/search without local index returns 409", async () => {
  const api = await startTestApi({ writeSongIndex: false });
  try {
    const response = await api.request("GET", "/api/search?q=krolowa");

    assert.equal(response.status, 409);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.body.error, "missing_song_index");
    assert.equal(response.body.message, "Missing local song index. Run pnpm import:ising and/or pnpm import:karafun.");
  } finally {
    await cleanupApi(api);
  }
});

test("POST /api/events creates an event without admin token when token is unset", async () => {
  const api = await startTestApi();
  try {
    const response = await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test", venue: "Club" });

    assert.equal(response.status, 201);
    assert.equal(response.body.event.id, "test-event");
    assert.equal(response.body.event.name, "Poza Nutą Test");
  } finally {
    await cleanupApi(api);
  }
});

test("API preserves UTF-8 request body and response data roundtrip", async () => {
  const api = await startTestApi();
  const eventName = "Poza Nut\u0105 Test";
  const singerName = "Micha\u0142";

  try {
    const eventResponse = await api.request("POST", "/api/events", { id: "utf8-test", name: eventName });
    const requestResponse = await api.request("POST", "/api/events/utf8-test/requests", {
      singerName,
      songSource: "ising",
      songSourceId: "9053"
    });
    const state = await loadQueueState(join(api.config.eventsDir, "utf8-test.json"));
    const serializedResponses = JSON.stringify([eventResponse.body, requestResponse.body, state]);

    assert.equal(eventResponse.status, 201);
    assert.equal(eventResponse.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(eventResponse.body.event.name, eventName);
    assert.equal(requestResponse.status, 201);
    assert.equal(requestResponse.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(requestResponse.body.request.singerName, singerName);
    assert.equal(state.event.name, eventName);
    assert.equal(state.requests[0].singerName, singerName);
    assert.doesNotMatch(serializedResponses, /\uFFFD/);
    assert.doesNotMatch(serializedResponses, /Poza Nut�/);
    assert.doesNotMatch(serializedResponses, /Micha�/);
  } finally {
    await cleanupApi(api);
  }
});

test("POST /api/events/:eventId/requests adds pending request by sourceSongId", async () => {
  const api = await startTestApi();
  try {
    await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" });
    const response = await api.request("POST", "/api/events/test-event/requests", {
      singerName: "Michał",
      songSource: "ising",
      songSourceId: "9053"
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.request.status, "pending");
    assert.equal(response.body.request.singerName, "Michał");
    assert.equal(response.body.request.songTitle, "Królowa Łez");
    assert.equal(response.body.request.songArtist, "Agnieszka Chylińska");
    assert.equal(response.body.request.songSource, "ising");
    assert.equal(response.body.request.songSourceId, "9053");
  } finally {
    await cleanupApi(api);
  }
});

test("participant request does not trust title or artist from body", async () => {
  const api = await startTestApi();
  try {
    await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" });
    const response = await api.request("POST", "/api/events/test-event/requests", {
      singerName: "Michał",
      songSource: "ising",
      songSourceId: "9053",
      title: "Fake Title",
      artist: "Fake Artist"
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.request.songTitle, "Królowa Łez");
    assert.equal(response.body.request.songArtist, "Agnieszka Chylińska");
  } finally {
    await cleanupApi(api);
  }
});

test("GET /api/events/:eventId/public-queue hides pending requests", async () => {
  const api = await startTestApi();
  try {
    await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" });
    await api.request("POST", "/api/events/test-event/requests", {
      singerName: "Michał",
      songSource: "ising",
      songSourceId: "9053"
    });
    const response = await api.request("GET", "/api/events/test-event/public-queue");

    assert.equal(response.status, 200);
    assert.equal(response.body.now, undefined);
    assert.equal(response.body.next, undefined);
    assert.deepEqual(response.body.upcoming, []);
  } finally {
    await cleanupApi(api);
  }
});

test("approve endpoint moves request into public queue", async () => {
  const api = await startTestApi();
  try {
    const requestId = await createEventAndPendingRequest(api);
    const approveResponse = await api.request("POST", `/api/events/test-event/requests/${requestId}/approve`);
    const publicResponse = await api.request("GET", "/api/events/test-event/public-queue");

    assert.equal(approveResponse.status, 200);
    assert.equal(publicResponse.body.next.songTitle, "Królowa Łez");
    assert.equal(publicResponse.body.upcoming.length, 0);
  } finally {
    await cleanupApi(api);
  }
});

test("start endpoint sets now and done endpoint moves now to done", async () => {
  const api = await startTestApi();
  try {
    const requestId = await createEventAndPendingRequest(api);
    await api.request("POST", `/api/events/test-event/requests/${requestId}/approve`);
    const startResponse = await api.request("POST", `/api/events/test-event/requests/${requestId}/start`);
    const publicAfterStart = await api.request("GET", "/api/events/test-event/public-queue");
    const doneResponse = await api.request("POST", "/api/events/test-event/done");
    const operatorAfterDone = await api.request("GET", "/api/events/test-event/operator-queue");

    assert.equal(startResponse.status, 200);
    assert.equal(publicAfterStart.body.now.songTitle, "Królowa Łez");
    assert.equal(doneResponse.status, 200);
    assert.equal(operatorAfterDone.body.done[0].songTitle, "Królowa Łez");
  } finally {
    await cleanupApi(api);
  }
});

test("admin token is required when API_ADMIN_TOKEN is configured", async () => {
  const api = await startTestApi({ adminToken: "secret-token" });
  try {
    const unauthorized = await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" });
    const authorized = await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" }, "secret-token");

    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.error, "unauthorized");
    assert.equal(authorized.status, 201);
  } finally {
    await cleanupApi(api);
  }
});

test("admin token is not required when API_ADMIN_TOKEN is unset", async () => {
  const api = await startTestApi();
  try {
    const response = await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" });

    assert.equal(response.status, 201);
  } finally {
    await cleanupApi(api);
  }
});

test("API does not perform requests to iSing", async () => {
  const api = await startTestApi();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("API must not call fetch");
  }) as typeof fetch;

  try {
    await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" });
    const requestResponse = await api.request("POST", "/api/events/test-event/requests", {
      singerName: "Michał",
      songSource: "ising",
      songSourceId: "9053"
    });

    assert.equal(requestResponse.status, 201);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupApi(api);
  }
});

test("API saves participant request to local queue JSON", async () => {
  const api = await startTestApi();
  try {
    await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" });
    await api.request("POST", "/api/events/test-event/requests", {
      singerName: "Michał",
      songSource: "ising",
      songSourceId: "9053"
    });
    const state = await loadQueueState(join(api.config.eventsDir, "test-event.json"));

    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].songTitle, "Królowa Łez");
  } finally {
    await cleanupApi(api);
  }
});

async function createEventAndPendingRequest(api: TestApi): Promise<string> {
  await api.request("POST", "/api/events", { id: "test-event", name: "Poza Nutą Test" });
  const requestResponse = await api.request("POST", "/api/events/test-event/requests", {
    singerName: "Michał",
    songSource: "ising",
    songSourceId: "9053"
  });

  return requestResponse.body.request.id;
}

async function startTestApi(options: { writeSongIndex?: boolean; songs?: LocalSong[]; adminToken?: string; logLevel?: ApiConfig["logLevel"]; songIndex?: LocalSongIndexCache } = {}): Promise<TestApi> {
  const tempDir = await mkdtemp(join(tmpdir(), "api-test-"));
  const eventsDir = join(tempDir, "events");
  const songIndexPath = join(tempDir, "ising-songs.json");
  const logs: string[] = [];
  const errors: string[] = [];
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 0,
    eventsDir,
    songIndexPath,
    adminToken: options.adminToken,
    logLevel: options.logLevel ?? "silent",
    songIndex: options.songIndex,
    logger: {
      log: (message) => logs.push(message),
      error: (message) => errors.push(message)
    }
  };

  if (options.writeSongIndex !== false) {
    await writeFile(songIndexPath, JSON.stringify(options.songs ?? fixtureSongs(), null, 2), "utf8");
  }

  const server = createApiServer(config);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  const port = typeof address === "object" && address ? address.port : 0;
  assert.notEqual(port, 0);
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    config,
    tempDir,
    logs,
    errors,
    request: (method, path, body, token) => requestJson(baseUrl, method, path, body, token),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function cleanupApi(api: TestApi): Promise<void> {
  await api.close();
  await rm(api.tempDir, { recursive: true, force: true });
}

function requestJson(baseUrl: string, method: string, path: string, body?: unknown, token?: string, extraHeaders: Record<string, string> = {}): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const rawBody = body === undefined ? undefined : JSON.stringify(body);
    const rawBodyBuffer = rawBody === undefined ? undefined : Buffer.from(rawBody, "utf8");
    const request = httpRequest(
      url,
      {
        method,
        headers: {
          ...(rawBodyBuffer ? { "content-type": "application/json; charset=utf-8", "content-length": rawBodyBuffer.byteLength } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...extraHeaders
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: text ? JSON.parse(text) : null
          });
        });
      }
    );

    request.on("error", reject);
    if (rawBodyBuffer) {
      request.write(rawBodyBuffer);
    }
    request.end();
  });
}

function fixtureSongs(): LocalSong[] {
  return [
    localSong({
      sourceSongId: "9053",
      artist: "Agnieszka Chylińska",
      title: "Królowa Łez",
      sourceUrl: "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka"
    }),
    localSong({
      sourceSongId: "abba-queen",
      artist: "ABBA",
      title: "Dancing Queen",
      sourceUrl: "https://ising.pl/abba-dancing-queen-piosenka"
    })
  ];
}

function manyFixtureSongs(count: number): LocalSong[] {
  return Array.from({ length: count }, (_value, index) =>
    localSong({
      sourceSongId: `song-${index + 1}`,
      artist: `Artist ${index + 1}`,
      title: `Song ${index + 1}`
    })
  );
}

function localSong(overrides: Partial<LocalSong>): LocalSong {
  const artist = overrides.artist ?? "Artist";
  const title = overrides.title ?? "Title";
  const genres = overrides.genres ?? ["Pop"];

  return {
    source: "ising",
    sourceSongId: overrides.sourceSongId ?? `${artist}-${title}`,
    title,
    subtitle: overrides.subtitle ?? null,
    artist,
    artistSourceId: overrides.artistSourceId ?? null,
    normalizedTitle: normalizeFixtureText(title),
    normalizedArtist: normalizeFixtureText(artist),
    searchText: overrides.searchText ?? normalizeFixtureText([artist, title, overrides.subtitle, ...genres].filter(Boolean).join(" ")),
    durationSeconds: overrides.durationSeconds ?? null,
    genres,
    isPlus: overrides.isPlus ?? false,
    isHit: overrides.isHit ?? false,
    isBuyAvailable: overrides.isBuyAvailable ?? false,
    sourceUrl: overrides.sourceUrl ?? null,
    sourceSelflink: overrides.sourceSelflink ?? null,
    sourceDateAdded: overrides.sourceDateAdded ?? null,
    availabilityStatus: "available",
    lastSeenAt: overrides.lastSeenAt ?? "2026-05-28T00:00:00.000Z",
    lastCheckedAt: overrides.lastCheckedAt ?? "2026-05-28T00:00:00.000Z"
  };
}

function normalizeFixtureText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
