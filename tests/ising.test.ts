import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadISingImporterConfig } from "../src/importers/ising/config.ts";
import { importISingSongs, ISingImportStoppedError } from "../src/importers/ising/importISingSongs.ts";
import { mapISingSong } from "../src/importers/ising/mapISingSong.ts";
import { normalizeSearchText } from "../src/importers/ising/normalizeSearchText.ts";
import { readAndValidateISingResponse } from "../src/importers/ising/safety.ts";
import type { LocalSong } from "../src/songs/types.ts";
import type { ISingApiSong, ISingImporterConfig, ISingSearchResponse } from "../src/importers/ising/types.ts";

test("normalizeSearchText normalizes Polish text and punctuation", () => {
  assert.equal(normalizeSearchText("Dżem - Wehikuł czasu"), "dzem wehikul czasu");
  assert.equal(normalizeSearchText("Agnieszka Chylińska - Królowa Łez"), "agnieszka chylinska krolowa lez");
  assert.equal(normalizeSearchText("  Sanah, Vito Bambino - Ale jazz! "), "sanah vito bambino ale jazz");
});

test("mapISingSong maps only safe local song fields", () => {
  const mapped = mapISingSong(
    {
      ...sampleSong(),
      subtitle: null,
      sample_url: "https://example.test/sample.mp3",
      links: {
        selflink: "https://api.ising.pl/v2/songs/123",
        selflink_lyrics: "https://api.ising.pl/v2/songs/123/lyrics",
        selflink_recs: "https://api.ising.pl/v2/songs/123/recs",
        selflink_battles: "https://api.ising.pl/v2/songs/123/battles"
      }
    },
    "2026-05-27T10:00:00.000Z"
  );

  assert.equal(mapped.sourceSongId, "123");
  assert.equal(mapped.subtitle, null);
  assert.equal(mapped.searchText, "dzem wehikul czasu rock");
  assert.equal(mapped.sourceSelflink, "https://api.ising.pl/v2/songs/123");
  assertNoUnsafeOutput(mapped);
});

test("safety check rejects HTML challenge response", async () => {
  await assert.rejects(
    () =>
      readAndValidateISingResponse(
        new Response("<html>Potwierdzenie dostępu</html>", {
          headers: { "content-type": "text/html" }
        }),
        "https://api.ising.pl/v2/search"
      ),
    /HTML verification\/challenge/
  );
});

test("safety check rejects 429", async () => {
  await assert.rejects(
    () => readAndValidateISingResponse(new Response("{}", { status: 429 }), "https://api.ising.pl/v2/search"),
    /HTTP 429 rate limit/
  );
});

test("safety check rejects missing songs array", async () => {
  await assert.rejects(
    () => readAndValidateISingResponse(jsonResponse({ data: { found: 1, q: "", results: {} } }), "https://api.ising.pl/v2/search"),
    /data\.results\.songs/
  );
});

test("safety check rejects lyrics field", async () => {
  await assert.rejects(
    () =>
      readAndValidateISingResponse(
        jsonResponse({
          data: { found: 1, q: "", results: { songs: [{ ...sampleSong(), lyrics: "secret" }] } }
        }),
        "https://api.ising.pl/v2/search"
      ),
    /Unexpected private\/sensitive field/
  );
});

test("safety check accepts valid response with songs", async () => {
  const parsed = await readAndValidateISingResponse(
    jsonResponse({
      data: { found: 1, q: "", results: { songs: [sampleSong()] } },
      links: {}
    }),
    "https://api.ising.pl/v2/search"
  );

  assert.equal(parsed.data.results.songs.length, 1);
});

test("config does not require ISING_IMPORT_CONTACT_EMAIL", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-config-"));
  try {
    const envPath = join(tempDir, ".env");
    await writeFile(
      envPath,
      [
        "ISING_API_BASE_URL=https://api.ising.pl/v2",
        "ISING_CLIENT_ID=public-web-client-id",
        "ISING_IMPORT_DELAY_MS=1",
        "ISING_IMPORT_CONTACT_EMAIL=",
        "ISING_IMPORT_USER_AGENT="
      ].join("\n"),
      "utf8"
    );

    const config = await loadISingImporterConfig(envPath);

    assert.equal(config.clientId, "public-web-client-id");
    assert.equal(config.contactEmail, undefined);
    assert.equal(config.userAgent, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer follows links.next and stops when it is missing", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const requestedUrls: string[] = [];
    const config = testConfig(tempDir);
    const fetchFn = async (url: string | URL | Request): Promise<Response> => {
      const href = String(url);
      requestedUrls.push(href);
      if (requestedUrls.length === 1) {
        return jsonResponse(pageResponse([sampleSong({ id: 1 })], "https://api.ising.pl/v2/search?start=20"));
      }
      return jsonResponse(pageResponse([sampleSong({ id: 2 })]));
    };

    const report = await importISingSongs(config, { fetchFn, delayFn: async () => {} });
    const output = JSON.parse(await readFile(config.outputSongsPath, "utf8")) as LocalSong[];

    assert.equal(report.pageCount, 2);
    assert.equal(requestedUrls.length, 2);
    assert.equal(requestedUrls[1], "https://api.ising.pl/v2/search?start=20");
    assert.equal(output.length, 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer blindly follows exact links.next URLs with start offsets", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const requestedUrls: string[] = [];
    const config = testConfig(tempDir);
    const firstNextUrl = "https://api.ising.pl/v2/search?start=20&server_cursor=page-2";
    const secondNextUrl = "https://api.ising.pl/v2/search?start=40&server_cursor=page-3";

    const fetchFn = async (url: string | URL | Request): Promise<Response> => {
      requestedUrls.push(String(url));

      if (requestedUrls.length === 1) {
        return jsonResponse(pageResponse([sampleSong({ id: 1 })], firstNextUrl));
      }

      if (requestedUrls.length === 2) {
        return jsonResponse(pageResponse([sampleSong({ id: 2 })], secondNextUrl));
      }

      return jsonResponse(pageResponse([sampleSong({ id: 3 })]));
    };

    const report = await importISingSongs(config, { fetchFn, delayFn: async () => {} });

    assert.equal(report.pageCount, 3);
    assert.deepEqual(requestedUrls.slice(1), [firstNextUrl, secondNextUrl]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer works without ISING_IMPORT_USER_AGENT and does not force a bot User-Agent", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const config = testConfig(tempDir);
    const requestHeaders: Record<string, string>[] = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requestHeaders.push(headersToRecord(init?.headers));
      return jsonResponse(pageResponse([sampleSong({ id: 1 })]));
    };

    await importISingSongs(config, { fetchFn, delayFn: async () => {} });

    assert.equal(requestHeaders.length, 1);
    assert.equal(requestHeaders[0]["user-agent"], undefined);
    assert.doesNotMatch(JSON.stringify(requestHeaders[0]), /PozaNutaSongbookBot/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer sends ISING_IMPORT_USER_AGENT when configured", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const config = {
      ...testConfig(tempDir),
      userAgent: "Mozilla/5.0 PozaNutaImport"
    };
    let requestHeaders: Record<string, string> | undefined;
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requestHeaders = headersToRecord(init?.headers);
      return jsonResponse(pageResponse([sampleSong({ id: 1 })]));
    };

    await importISingSongs(config, { fetchFn, delayFn: async () => {} });

    assert.equal(requestHeaders?.["user-agent"], "Mozilla/5.0 PozaNutaImport");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer resolves relative links.next against the API base path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const requestedUrls: string[] = [];
    const config = testConfig(tempDir);
    const fetchFn = async (url: string | URL | Request): Promise<Response> => {
      requestedUrls.push(String(url));
      return requestedUrls.length === 1 ? jsonResponse(pageResponse([sampleSong({ id: 1 })], "search?start=20")) : jsonResponse(pageResponse([]));
    };

    await importISingSongs(config, { fetchFn, delayFn: async () => {} });
    assert.equal(requestedUrls[1], "https://api.ising.pl/v2/search?start=20");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer stops on 429 without extra requests", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const config = testConfig(tempDir);
    let requests = 0;
    const fetchFn = async (): Promise<Response> => {
      requests += 1;
      return new Response("{}", { status: 429 });
    };

    await assert.rejects(() => importISingSongs(config, { fetchFn, delayFn: async () => {} }), ISingImportStoppedError);
    assert.equal(requests, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer does not retry HTML challenge pages returned with 5xx", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const config = testConfig(tempDir);
    let requests = 0;
    const fetchFn = async (): Promise<Response> => {
      requests += 1;
      return new Response("<html>Trwa automatyczna weryfikacja</html>", {
        status: 503,
        headers: { "content-type": "text/html" }
      });
    };

    await assert.rejects(() => importISingSongs(config, { fetchFn, delayFn: async () => {} }), /HTML verification\/challenge/);
    assert.equal(requests, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer does not run requests in parallel", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const config = testConfig(tempDir);
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let requests = 0;

    const fetchFn = async (): Promise<Response> => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      requests += 1;
      await Promise.resolve();
      activeRequests -= 1;

      return requests === 1 ? jsonResponse(pageResponse([sampleSong({ id: 1 })], "/v2/search?start=20")) : jsonResponse(pageResponse([sampleSong({ id: 2 })]));
    };

    await importISingSongs(config, { fetchFn, delayFn: async () => {} });
    assert.equal(maxActiveRequests, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer rejects invalid response shape", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const config = testConfig(tempDir);
    const fetchFn = async (): Promise<Response> => jsonResponse({ data: { found: 1, q: "", results: { songs: null } } });

    await assert.rejects(() => importISingSongs(config, { fetchFn, delayFn: async () => {} }), /data\.results\.songs/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer output excludes sample_url, lyrics links, audio, lyrics, user and recordings fields", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const config = testConfig(tempDir);
    const fetchFn = async (): Promise<Response> =>
      jsonResponse(
        pageResponse([
          {
            ...sampleSong(),
            sample_url: "https://example.test/sample.mp3",
            recordings_count: 10,
            colors: ["red"],
            images: { cover: "https://example.test/cover.jpg" },
            links: {
              selflink: "https://api.ising.pl/v2/songs/123",
              selflink_lyrics: "https://api.ising.pl/v2/songs/123/lyrics"
            }
          } as ISingApiSong
        ])
      );

    await importISingSongs(config, { fetchFn, delayFn: async () => {} });
    const outputText = await readFile(config.outputSongsPath, "utf8");

    assert.doesNotMatch(outputText, /sample_url/);
    assert.doesNotMatch(outputText, /selflink_lyrics/);
    assert.doesNotMatch(outputText, /audio/);
    assert.doesNotMatch(outputText, /lyrics/);
    assert.doesNotMatch(outputText, /recordings/);
    assert.doesNotMatch(outputText, /user/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("importer is idempotent for JSON output", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "ising-import-"));
  try {
    const config = testConfig(tempDir);
    const fetchFn = async (): Promise<Response> => jsonResponse(pageResponse([sampleSong({ id: 1 })]));

    await importISingSongs(config, { fetchFn, delayFn: async () => {} });
    await importISingSongs(config, { fetchFn, delayFn: async () => {} });
    const output = JSON.parse(await readFile(config.outputSongsPath, "utf8")) as LocalSong[];

    assert.equal(output.length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function sampleSong(overrides: Partial<ISingApiSong> = {}): ISingApiSong {
  return {
    id: 123,
    title: "Wehikuł czasu",
    subtitle: null,
    artist: "Dżem",
    artist_id: 456,
    date_added: "2026-01-01",
    duration: 245,
    genre: ["Rock"],
    plus: true,
    hit: false,
    buy: true,
    permalink: "https://ising.pl/dzem-wehikul-czasu",
    links: {
      selflink: "https://api.ising.pl/v2/songs/123"
    },
    ...overrides
  };
}

function pageResponse(songs: ISingApiSong[], next?: string): ISingSearchResponse {
  return {
    data: {
      found: songs.length,
      q: "",
      results: {
        songs
      }
    },
    links: next ? { next } : {}
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    }
  });
}

function testConfig(tempDir: string): ISingImporterConfig {
  return {
    apiBaseUrl: "https://api.ising.pl/v2",
    clientId: "client-id",
    delayMs: 1,
    tag: "",
    order: "-artist_string",
    outputSongsPath: join(tempDir, "ising-songs.json"),
    outputReportPath: join(tempDir, "ising-import-report.json"),
    timeoutMs: 15_000,
    maxNetworkRetries: 1
  };
}

function assertNoUnsafeOutput(value: unknown): void {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /sample_url/);
  assert.doesNotMatch(text, /selflink_lyrics/);
  assert.doesNotMatch(text, /selflink_recs/);
  assert.doesNotMatch(text, /selflink_battles/);
  assert.doesNotMatch(text, /audio/);
  assert.doesNotMatch(text, /lyrics/);
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key.toLowerCase(), value]));
  }

  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}
