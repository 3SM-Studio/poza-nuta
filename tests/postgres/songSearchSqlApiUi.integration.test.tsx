// @vitest-environment jsdom

import assert from "node:assert/strict";

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type postgres from "postgres";
import { afterEach, expect, test, vi } from "vitest";

import { normalizeSongSearchText } from "../../src/lib/song-search.ts";
import {
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "./postgresTestHarness.ts";

const { apiSearch, routerBack, routerPush, routerReplace, routerRefresh } = vi.hoisted(
  () => ({
    apiSearch: vi.fn(),
    routerBack: vi.fn(),
    routerPush: vi.fn(),
    routerReplace: vi.fn(),
    routerRefresh: vi.fn(),
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("@/components/public/session-api", () => ({
  cancelParticipantRequest: vi.fn(),
  createSessionRequest: vi.fn(),
  getParticipantRequests: vi.fn().mockResolvedValue({ items: [] }),
  getSessionEvent: vi.fn(),
  getSessionQueue: vi.fn(),
  renameSessionParticipant: vi.fn(),
  searchSessionSongs: apiSearch,
  SessionClientError: class SessionClientError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/components/public/use-public-queue-realtime", () => ({
  usePublicQueueRealtime: () => "disconnected",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/s/sql-api-ui-token",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    back: routerBack,
    push: routerPush,
    replace: routerReplace,
    refresh: routerRefresh,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const event = {
  name: "SQL API UI Event",
  venue: null,
  startsAt: "2026-09-19T16:00:00.000Z",
  status: "active" as const,
  publicQueueEnabled: false,
  songRequestsEnabled: true,
  publicShowSongTitles: false,
  autoCloseAt: "2026-09-20T00:00:00.000Z",
  endsAt: "2026-09-20T00:00:00.000Z",
  closedAt: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  apiSearch.mockReset();
});

test("real PostgreSQL ranking flows through the API into SessionRequestPage pagination", async () => {
  const harness = await startPostgresTestHarness(
    "pozanuta-search-sql-api-ui",
    "postgres:17-alpine",
  );
  const sql = createPostgresTestClient(harness, "postgres", 4);

  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, process.env.SONG_SEARCH_ENGINE === "unicode-v2" ? 31 : 27);
    await seedSqlApiUiSongs(sql);

    await withApplicationDatabase(harness, async () => {
      const publicSearchRoute = await import(
        "../../src/app/api/public/songs/search/route.ts"
      );
      const { SessionRequestPage } = await import(
        "../../src/components/public/session-request-page.tsx"
      );

      apiSearch.mockImplementation(
        async (
          _token: string,
          query: string,
          _signal?: AbortSignal,
          cursor?: string,
        ) => {
          const searchParams = new URLSearchParams({ q: query });
          if (cursor) searchParams.set("cursor", cursor);
          const response = await publicSearchRoute.GET(
            new Request(
              `http://localhost/api/public/songs/search?${searchParams.toString()}`,
            ),
          );
          assert.equal(response.status, 200);
          return response.json();
        },
      );

      vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
      render(
        <SessionRequestPage event={event} sessionToken="sql-api-ui-token" />,
      );

      for (const [query, expected] of [
        ["Dancing Queen ABBA", "Dancing Queen — ABBA"],
        ["Bohemian Rapsody", "Bohemian Rhapsody — Queen"],
        ["Poker Face Lady Gaga", "Poker Face — Lady Gaga"],
        ["Gorniak", "To nie ja — Edyta Górniak"],
      ] as const) {
        const searchbox = screen.getByRole("searchbox");
        fireEvent.change(searchbox, { target: { value: query } });
        fireEvent.submit(searchbox.closest("form")!);
        const [title, artist] = expected.split(" — ") as [string, string];
        const titleElement = await screen.findByText(title);
        expect(titleElement.closest("button")).toHaveTextContent(artist);
        expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
          title,
        );
        expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
          artist,
        );
      }

      const searchbox = screen.getByRole("searchbox");
      fireEvent.change(searchbox, { target: { value: "Love" } });
      fireEvent.submit(searchbox.closest("form")!);
      const loadMore = await screen.findByRole("button", { name: "Pokaż więcej" });
      expect(screen.queryByText("ZZZ Intended")).not.toBeInTheDocument();

      fireEvent.click(loadMore);
      await screen.findByText("ZZZ Intended");
      expect(screen.getAllByRole("listitem")).toHaveLength(66);
      expect(screen.queryByRole("button", { name: "Pokaż więcej" })).not.toBeInTheDocument();
      expect(searchbox).toHaveFocus();
      expect(apiSearch).toHaveBeenLastCalledWith(
        "sql-api-ui-token",
        "Love",
        expect.any(AbortSignal),
        expect.any(String),
      );
    });
  } finally {
    await act(async () => undefined);
    await sql.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
}, 180_000);

async function seedSqlApiUiSongs(sql: postgres.Sql) {
  for (const [title, artist] of [
    ["Dancing Queen", "ABBA"],
    ["Bohemian Rhapsody", "Queen"],
    ["Poker Face", "Lady Gaga"],
    ["To nie ja", "Edyta Górniak"],
    ["Bohemian Dream", "Rhapsody Lane"],
    ["Poker Faces", "Lady Grey"],
  ] as const) {
    await insertSong(sql, title, artist, `target-${title}`);
  }

  for (let index = 1; index <= 65; index += 1) {
    await insertSong(
      sql,
      "Love",
      `Artist ${String(index).padStart(3, "0")}`,
      `love-${index}`,
    );
  }
  await insertSong(sql, "Love", "ZZZ Intended", "love-intended");
}

async function insertSong(
  sql: postgres.Sql,
  title: string,
  artist: string,
  sourceId: string,
) {
  await sql`
    insert into songs (
      source, source_song_id, title, artist, normalized_title,
      normalized_artist, search_text
    ) values (
      'manual', ${sourceId}, ${title}, ${artist},
      ${normalizeSongSearchText(title)},
      ${normalizeSongSearchText(artist)},
      ${normalizeSongSearchText(`${artist} ${title} karaoke english`)}
    )
  `;
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
