import assert from "node:assert/strict";

import { NextRequest } from "next/server";
import { test, vi } from "vitest";

import {
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;

for (const image of images) {
  test(`${image}: participant song discovery stays bounded and lifecycle-safe`, async () => {
    const harness = await startPostgresTestHarness(
      "pozanuta-song-discovery",
      image,
    );
    const sql = createPostgresTestClient(harness, "postgres", 4);

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 24);
      const fixture = await seedFixture(sql);

      await withApplicationDatabase(harness, async () => {
        const service = await import("../../src/server/session-api/service.ts");
        const validation = await import(
          "../../src/server/session-api/validation.ts"
        );

        const defaultQuery = validBrowseQuery(validation, new URLSearchParams());
        const firstPage = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(validation, new URLSearchParams({ limit: "2" })),
        );
        assert.deepEqual(
          firstPage.items.map(({ title }) => title),
          ["Alpha Anthem", "Bravo Ballad"],
        );
        assert.equal(typeof firstPage.nextCursor, "string");
        assert.ok(firstPage.nextCursor);

        const secondPage = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(
            validation,
            new URLSearchParams({ limit: "2", cursor: firstPage.nextCursor }),
          ),
        );
        assert.equal(
          secondPage.items.some((item) => item.title === "Alpha Anthem"),
          false,
        );
        assert.equal(
          secondPage.items.some((item) => item.title === "Bravo Ballad"),
          false,
        );

        const newest = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(validation, new URLSearchParams({ sort: "newest" })),
        );
        assert.equal(newest.items[0]?.title, "Newest Cut");

        const titleTieFirst = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(
            validation,
            new URLSearchParams({ q: "shared", limit: "1" }),
          ),
        );
        assert.equal(titleTieFirst.items.length, 1);
        assert.ok(titleTieFirst.nextCursor);
        const titleTieSecond = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(
            validation,
            new URLSearchParams({
              q: "shared",
              limit: "1",
              cursor: titleTieFirst.nextCursor,
            }),
          ),
        );
        assert.equal(titleTieSecond.items.length, 1);
        assert.equal(titleTieFirst.items[0]?.title, "Shared Song");
        assert.equal(titleTieSecond.items[0]?.title, "Shared Song");
        assert.equal(titleTieFirst.items[0]?.artist, "Shared Artist");
        assert.equal(titleTieSecond.items[0]?.artist, "Shared Artist");
        assert.notEqual(titleTieFirst.items[0]?.id, titleTieSecond.items[0]?.id);

        const newestTieFirst = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(
            validation,
            new URLSearchParams({ q: "fresh tie", limit: "1", sort: "newest" }),
          ),
        );
        assert.equal(newestTieFirst.items.length, 1);
        assert.ok(newestTieFirst.nextCursor);
        const newestTieSecond = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(
            validation,
            new URLSearchParams({
              q: "fresh tie",
              limit: "1",
              sort: "newest",
              cursor: newestTieFirst.nextCursor,
            }),
          ),
        );
        assert.equal(newestTieSecond.items.length, 1);
        assert.notEqual(newestTieFirst.items[0]?.id, newestTieSecond.items[0]?.id);

        const searched = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(validation, new URLSearchParams({ q: "bravo" })),
        );
        assert.deepEqual(searched.items.map(({ title }) => title), ["Bravo Ballad"]);

        const byGenre = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(validation, new URLSearchParams({ genre: "pop" })),
        );
        assert.ok(byGenre.items.every((song) => song.genres.length > 0));
        assert.ok(byGenre.items.some((song) => song.title === "Bravo Ballad"));

        const byLanguage = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(
            validation,
            new URLSearchParams({ language: "english" }),
          ),
        );
        assert.ok(byLanguage.items.every((song) => song.languages.includes("English")));

        const duets = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(validation, new URLSearchParams({ duet: "true" })),
        );
        assert.deepEqual(duets.items.map(({ title }) => title), ["Bravo Ballad"]);

        const hits = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(validation, new URLSearchParams({ hit: "true" })),
        );
        assert.deepEqual(hits.items.map(({ title }) => title), ["Bravo Ballad"]);

        const combined = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(
            validation,
            new URLSearchParams({
              genre: "pop",
              language: "english",
              duet: "true",
              hit: "true",
            }),
          ),
        );
        assert.deepEqual(combined.items.map(({ title }) => title), ["Bravo Ballad"]);

        const empty = await service.browsePublicSessionSongs(
          fixture.activeToken,
          validBrowseQuery(validation, new URLSearchParams({ q: "no-match" })),
        );
        assert.deepEqual(empty, { items: [], nextCursor: null });

        const discovery = await service.getPublicSessionSongDiscovery(
          fixture.activeToken,
        );
        const pop = discovery.genres.find((genre) => genre.value === "pop");
        assert.ok(pop);
        assert.ok(pop.count >= 20);
        assert.ok(
          discovery.languages.some((language) => language.value === "english"),
        );
        assert.deepEqual(discovery.features, {
          duetCount: 1,
          hitCount: 1,
          plusCount: 0,
        });

        assert.equal(
          validation.validatePublicSongBrowseQuery(
            new URLSearchParams({
              genre: "rock",
              cursor: firstPage.nextCursor,
            }),
          ).success,
          false,
        );
        assert.equal(
          validation.validatePublicSongBrowseQuery(
            new URLSearchParams({ cursor: "invalid" }),
          ).success,
          false,
        );
        assert.equal(
          validBrowseQuery(
            validation,
            new URLSearchParams({ limit: "999" }),
          ).limit,
          40,
        );

        await assert.rejects(
          service.browsePublicSessionSongs(fixture.scheduledToken, defaultQuery),
          hasPublicError(403, "SESSION_EVENT_NOT_STARTED"),
        );
        await assert.rejects(
          service.browsePublicSessionSongs("Z".repeat(22), defaultQuery),
          hasPublicError(404, "SESSION_LINK_INVALID"),
        );

        const { GET } = await import(
          "../../src/app/api/s/[token]/songs/browse/route.ts"
        );
        const invalidCursorResponse = await GET(
          new NextRequest(
            `http://localhost/api/s/${fixture.activeToken}/songs/browse?cursor=invalid`,
          ),
          { params: Promise.resolve({ token: fixture.activeToken }) },
        );
        assert.equal(invalidCursorResponse.status, 400);
        assert.equal(
          (await invalidCursorResponse.json()).error.code,
          "VALIDATION_ERROR",
        );
      });
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });
}

function validBrowseQuery(
  validation: typeof import("../../src/server/session-api/validation.ts"),
  searchParams: URLSearchParams,
) {
  const result = validation.validatePublicSongBrowseQuery(searchParams);
  assert.equal(result.success, true);
  if (!result.success) throw new Error("Expected a valid browse query.");
  return result.data;
}

async function seedFixture(sql: ReturnType<typeof createPostgresTestClient>) {
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Song discovery test', 'song-discovery-test', 'songdiscoverytest001')
    RETURNING id::integer
  `;
  assert.ok(workspace);

  const now = new Date();
  const [activeEvent] = await sql<{ id: number }[]>`
    INSERT INTO public.events (
      workspace_id, name, session_code, starts_at, ends_at, status,
      song_requests_enabled, public_queue_enabled
    ) VALUES (
      ${workspace.id}, 'Discovery active', '10101010',
      ${new Date(now.getTime() - 3_600_000)},
      ${new Date(now.getTime() + 3_600_000)},
      'active', true, true
    ) RETURNING id::integer
  `;
  const [scheduledEvent] = await sql<{ id: number }[]>`
    INSERT INTO public.events (
      workspace_id, name, session_code, starts_at, ends_at, status,
      song_requests_enabled, public_queue_enabled
    ) VALUES (
      ${workspace.id}, 'Discovery scheduled', '20202020',
      ${new Date(now.getTime() + 3_600_000)},
      ${new Date(now.getTime() + 7_200_000)},
      'draft', true, true
    ) RETURNING id::integer
  `;
  assert.ok(activeEvent && scheduledEvent);

  const activeToken = "D".repeat(22);
  const scheduledToken = "E".repeat(22);
  await sql`
    INSERT INTO public.event_sessions (event_id, public_token)
    VALUES (${activeEvent.id}, ${activeToken}), (${scheduledEvent.id}, ${scheduledToken})
  `;

  const fixedSongs = [
    {
      title: "Alpha Anthem",
      artist: "Artist A",
      normalizedTitle: "alpha anthem",
      normalizedArtist: "artist a",
      searchText: "alpha anthem artist a pop english",
      genres: ["Pop"],
      languages: ["English"],
      isDuet: false,
      isHit: false,
      createdAt: new Date("2026-08-10T10:00:00.000Z"),
    },
    {
      title: "Bravo Ballad",
      artist: "Artist B",
      normalizedTitle: "bravo ballad",
      normalizedArtist: "artist b",
      searchText: "bravo ballad artist b pop english duet hit",
      genres: ["pop"],
      languages: ["English"],
      isDuet: true,
      isHit: true,
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
    },
    {
      title: "Newest Cut",
      artist: "Artist Z",
      normalizedTitle: "newest cut",
      normalizedArtist: "artist z",
      searchText: "newest cut artist z rock polish",
      genres: ["Rock"],
      languages: ["Polish"],
      isDuet: false,
      isHit: false,
      createdAt: new Date("2026-08-12T10:00:00.000Z"),
    },
    {
      title: "Shared Song",
      artist: "Shared Artist",
      normalizedTitle: "shared song",
      normalizedArtist: "shared artist",
      searchText: "shared song shared artist",
      genres: ["Pop"],
      languages: ["English"],
      isDuet: false,
      isHit: false,
      createdAt: new Date("2026-08-08T10:00:00.000Z"),
    },
    {
      title: "Shared Song",
      artist: "Shared Artist",
      normalizedTitle: "shared song",
      normalizedArtist: "shared artist",
      searchText: "shared song shared artist alternate",
      genres: ["Pop"],
      languages: ["English"],
      isDuet: false,
      isHit: false,
      createdAt: new Date("2026-08-07T10:00:00.000Z"),
    },
    {
      title: "Fresh Tie One",
      artist: "Fresh Artist",
      normalizedTitle: "fresh tie one",
      normalizedArtist: "fresh artist",
      searchText: "fresh tie one fresh artist",
      genres: ["Pop"],
      languages: ["English"],
      isDuet: false,
      isHit: false,
      createdAt: new Date("2026-08-06T10:00:00.000Z"),
    },
    {
      title: "Fresh Tie Two",
      artist: "Fresh Artist",
      normalizedTitle: "fresh tie two",
      normalizedArtist: "fresh artist",
      searchText: "fresh tie two fresh artist",
      genres: ["Pop"],
      languages: ["English"],
      isDuet: false,
      isHit: false,
      createdAt: new Date("2026-08-06T10:00:00.000Z"),
    },
  ];
  const fillerSongs = Array.from({ length: 19 }, (_, index) => ({
    title: `Pop Fixture ${String(index + 1).padStart(2, "0")}`,
    artist: "Fixture Artist",
    normalizedTitle: `pop fixture ${String(index + 1).padStart(2, "0")}`,
    normalizedArtist: "fixture artist",
    searchText: `pop fixture ${index + 1} fixture artist pop english`,
    genres: ["Pop"],
    languages: ["English"],
    isDuet: false,
    isHit: false,
    createdAt: new Date("2026-08-09T10:00:00.000Z"),
  }));

  for (const [index, song] of [...fixedSongs, ...fillerSongs].entries()) {
    await sql`
      INSERT INTO public.songs (
        source, source_song_id, title, artist, normalized_title,
        normalized_artist, search_text, genres, languages, is_duet, is_hit,
        created_at, updated_at
      ) VALUES (
        'manual', ${`song-discovery-${index}`}, ${song.title}, ${song.artist},
        ${song.normalizedTitle}, ${song.normalizedArtist}, ${song.searchText},
        ${song.genres}, ${song.languages}, ${song.isDuet}, ${song.isHit},
        ${song.createdAt}, ${song.createdAt}
      )
    `;
  }

  return { activeToken, scheduledToken };
}

function hasPublicError(status: number, code: string) {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    error.status === status &&
    error.code === code;
}

async function withApplicationDatabase<T>(
  harness: PostgresTestHarness,
  action: () => Promise<T>,
) {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `postgresql://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
  clearApplicationDatabase();

  try {
    return await action();
  } finally {
    const database = getApplicationDatabase();
    if (database) await database.$client.end({ timeout: 5 });
    clearApplicationDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

type ApplicationDatabase = {
  $client: { end(options: { timeout: number }): Promise<void> };
};

function getApplicationDatabase() {
  return (
    globalThis as typeof globalThis & { pozaNutaDatabase?: ApplicationDatabase }
  ).pozaNutaDatabase;
}

function clearApplicationDatabase() {
  delete (
    globalThis as typeof globalThis & { pozaNutaDatabase?: ApplicationDatabase }
  ).pozaNutaDatabase;
}
