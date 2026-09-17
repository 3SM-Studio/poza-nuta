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
  test(`${image}: global catalog collections preserve access, membership and keyset pagination`, async () => {
    const harness = await startPostgresTestHarness(
      "pozanuta-catalog-collections",
      image,
    );
    const sql = createPostgresTestClient(harness, "postgres", 4);

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 26);
      const fixture = await seedFixture(sql);
      await assertDatabaseInvariants(sql, fixture);
      await assertRuntimeRoleAccess(sql);

      await withApplicationDatabase(harness, async () => {
        const service = await import("../../src/server/session-api/service.ts");
        const validation = await import(
          "../../src/server/session-api/validation.ts"
        );

        const firstWorkspaceList =
          await service.listPublicSessionCatalogCollections(
            fixture.firstToken,
            "playlist",
          );
        const secondWorkspaceList =
          await service.listPublicSessionCatalogCollections(
            fixture.secondToken,
            "playlist",
          );
        assert.deepEqual(firstWorkspaceList, secondWorkspaceList);
        assert.deepEqual(
          firstWorkspaceList.items.map(({ filterKey }) => filterKey),
          ["pl_test-classics"],
        );
        assert.equal(
          "eventId" in firstWorkspaceList.items[0]!,
          false,
        );
        assert.equal(
          "workspaceId" in firstWorkspaceList.items[0]!,
          false,
        );

        const firstPage = await service.browsePublicSessionCatalogCollection(
          fixture.firstToken,
          validCollectionQuery(
            validation,
            new URLSearchParams({ filter: "pl_test-classics" }),
          ),
        );
        assert.equal(firstPage.collection.title, "Testowe klasyki");
        assert.equal(firstPage.items.length, 50);
        assert.ok(firstPage.nextCursor);
        const manualCursor = JSON.parse(
          Buffer.from(firstPage.nextCursor!, "base64url").toString("utf8"),
        ) as Record<string, unknown>;
        assert.deepEqual(Object.keys(manualCursor).sort(), [
          "filterKey", "mode", "songId", "version",
        ]);
        assert.equal(manualCursor.songId, firstPage.items.at(-1)?.id);

        const secondPage = await service.browsePublicSessionCatalogCollection(
          fixture.firstToken,
          validCollectionQuery(
            validation,
            new URLSearchParams({
              filter: "pl_test-classics",
              cursor: firstPage.nextCursor!,
            }),
          ),
        );
        assert.equal(secondPage.items.length, 10);
        assert.equal(secondPage.nextCursor, null);
        const manualTitles = [...firstPage.items, ...secondPage.items].map(
          ({ title }) => title,
        );
        assert.deepEqual(manualTitles, fixture.manualTitles);
        assert.equal(new Set(manualTitles).size, 60);

        const stylePage = await service.browsePublicSessionCatalogCollection(
          fixture.secondToken,
          validCollectionQuery(
            validation,
            new URLSearchParams({ filter: "st_test-style" }),
          ),
        );
        assert.equal(stylePage.collection.type, "style");
        assert.equal(stylePage.items.length, 50);
        assert.ok(stylePage.nextCursor);
        const styleNextPage = await service.browsePublicSessionCatalogCollection(
          fixture.secondToken,
          validCollectionQuery(
            validation,
            new URLSearchParams({
              filter: "st_test-style",
              cursor: stylePage.nextCursor!,
            }),
          ),
        );
        assert.equal(styleNextPage.items.length, 1);
        assert.equal(styleNextPage.nextCursor, null);
        assert.equal(stylePage.items.at(-1)?.title, styleNextPage.items[0]?.title);
        assert.equal(stylePage.items.at(-1)?.artist, styleNextPage.items[0]?.artist);
        const styleItems = [...stylePage.items, ...styleNextPage.items];
        assert.ok(
          styleItems.every((song) =>
            song.genres.some(
              (genre) => genre.toLocaleLowerCase("en-US") === "test style",
            ),
          ),
        );
        assert.equal(
          new Set(styleItems.map(({ id }) => id)).size,
          51,
        );

        assert.equal(
          validation.validateCatalogCollectionBrowseQuery(
            new URLSearchParams({
              filter: "pl_inactive",
              cursor: firstPage.nextCursor!,
            }),
          ).success,
          false,
        );
        await assert.rejects(
          service.browsePublicSessionCatalogCollection(
            fixture.firstToken,
            {
              filterKey: "pl_test-classics",
              limit: 50,
              cursor: {
                version: 1,
                filterKey: "pl_test-classics",
                mode: "rule",
                normalizedTitle: "collection song 49",
                normalizedArtist: "fixture artist",
                id: styleItems[0]!.id,
              },
            },
          ),
          hasPublicError(400, "CATALOG_COLLECTION_CURSOR_INVALID"),
        );

        await assert.rejects(
          service.browsePublicSessionCatalogCollection(
            fixture.firstToken,
            validCollectionQuery(
              validation,
              new URLSearchParams({ filter: "pl_inactive" }),
            ),
          ),
          hasPublicError(404, "CATALOG_COLLECTION_NOT_FOUND"),
        );
        await assert.rejects(
          service.listPublicSessionCatalogCollections(
            fixture.scheduledToken,
            "playlist",
          ),
          hasPublicError(403, "SESSION_EVENT_NOT_STARTED"),
        );
        await assert.rejects(
          service.listPublicSessionCatalogCollections(
            fixture.disabledToken,
            "playlist",
          ),
          hasPublicError(403, "SESSION_PUBLIC_REQUESTS_DISABLED"),
        );
        await assert.rejects(
          service.listPublicSessionCatalogCollections("Z".repeat(22), "playlist"),
          hasPublicError(404, "SESSION_LINK_INVALID"),
        );

        const { GET } = await import(
          "../../src/app/api/s/[token]/catalog/playlist/route.ts"
        );
        const invalidFilterResponse = await GET(
          new NextRequest(
            `http://localhost/api/s/${fixture.firstToken}/catalog/playlist?filter=123`,
          ),
          { params: Promise.resolve({ token: fixture.firstToken }) },
        );
        assert.equal(invalidFilterResponse.status, 400);
        assert.equal(
          (await invalidFilterResponse.json()).error.code,
          "VALIDATION_ERROR",
        );

        const invalidSessionResponse = await GET(
          new NextRequest(
            `http://localhost/api/s/${"Z".repeat(22)}/catalog/playlist?filter=pl_test-classics`,
          ),
          { params: Promise.resolve({ token: "Z".repeat(22) }) },
        );
        assert.equal(invalidSessionResponse.status, 404);
        assert.equal(
          (await invalidSessionResponse.json()).error.code,
          "SESSION_LINK_INVALID",
        );
      });
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  }, 600_000);
}

function validCollectionQuery(
  validation: typeof import("../../src/server/session-api/validation.ts"),
  searchParams: URLSearchParams,
) {
  const result = validation.validateCatalogCollectionBrowseQuery(searchParams);
  assert.equal(result.success, true);
  if (!result.success) throw new Error("Expected a valid collection query.");
  return result.data;
}

async function seedFixture(sql: ReturnType<typeof createPostgresTestClient>) {
  const [firstWorkspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Catalog workspace one', 'catalog-workspace-one', 'catalogcollections01')
    RETURNING id::integer
  `;
  const [secondWorkspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Catalog workspace two', 'catalog-workspace-two', 'catalogcollections02')
    RETURNING id::integer
  `;
  assert.ok(firstWorkspace && secondWorkspace);

  const now = new Date();
  const [firstEvent] = await sql<{ id: number }[]>`
    INSERT INTO public.events (
      workspace_id, name, session_code, starts_at, ends_at, status,
      song_requests_enabled
    ) VALUES (
      ${firstWorkspace.id}, 'Catalog event one', '31313131',
      ${new Date(now.getTime() - 3_600_000)},
      ${new Date(now.getTime() + 3_600_000)}, 'active', true
    ) RETURNING id::integer
  `;
  const [secondEvent] = await sql<{ id: number }[]>`
    INSERT INTO public.events (
      workspace_id, name, session_code, starts_at, ends_at, status,
      song_requests_enabled
    ) VALUES (
      ${secondWorkspace.id}, 'Catalog event two', '32323232',
      ${new Date(now.getTime() - 3_600_000)},
      ${new Date(now.getTime() + 3_600_000)}, 'active', true
    ) RETURNING id::integer
  `;
  const [scheduledEvent] = await sql<{ id: number }[]>`
    INSERT INTO public.events (
      workspace_id, name, session_code, starts_at, ends_at, status,
      song_requests_enabled
    ) VALUES (
      ${firstWorkspace.id}, 'Catalog scheduled', '33333333',
      ${new Date(now.getTime() + 3_600_000)},
      ${new Date(now.getTime() + 7_200_000)}, 'draft', true
    ) RETURNING id::integer
  `;
  const [disabledEvent] = await sql<{ id: number }[]>`
    INSERT INTO public.events (
      workspace_id, name, session_code, starts_at, ends_at, status,
      song_requests_enabled
    ) VALUES (
      ${firstWorkspace.id}, 'Catalog requests disabled', '34343434',
      ${new Date(now.getTime() - 3_600_000)},
      ${new Date(now.getTime() + 3_600_000)}, 'active', false
    ) RETURNING id::integer
  `;
  assert.ok(firstEvent && secondEvent && scheduledEvent && disabledEvent);

  const firstToken = "G".repeat(22);
  const secondToken = "H".repeat(22);
  const scheduledToken = "I".repeat(22);
  const disabledToken = "J".repeat(22);
  await sql`
    INSERT INTO public.event_sessions (event_id, public_token)
    VALUES
      (${firstEvent.id}, ${firstToken}),
      (${secondEvent.id}, ${secondToken}),
      (${scheduledEvent.id}, ${scheduledToken}),
      (${disabledEvent.id}, ${disabledToken})
  `;

  const insertedSongs: Array<{ id: number; title: string }> = [];
  for (let index = 0; index < 60; index += 1) {
    const title = `Collection Song ${String(index + 1).padStart(2, "0")}`;
    const [song] = await sql<{ id: number; title: string }[]>`
      INSERT INTO public.songs (
        source, source_song_id, title, artist, normalized_title,
        normalized_artist, search_text, genres, languages
      ) VALUES (
        'manual', ${`catalog-collection-${index}`}, ${title}, 'Fixture Artist',
        ${title.toLocaleLowerCase("en-US")}, 'fixture artist',
        ${`${title} fixture artist`},
        ${index < 49 ? ["Test Style"] : ["Other Style"]},
        ${["Polish"]}
      ) RETURNING id::integer, title
    `;
    assert.ok(song);
    insertedSongs.push(song);
  }

  for (let index = 0; index < 2; index += 1) {
    await sql`
      INSERT INTO public.songs (
        source, source_song_id, title, artist, normalized_title,
        normalized_artist, search_text, genres, languages
      ) VALUES (
        'manual', ${`catalog-style-tie-${index}`}, 'Collection Song 49',
        'Fixture Artist', 'collection song 49', 'fixture artist',
        'collection song 49 fixture artist', ${["Test Style"]}, ${["Polish"]}
      )
    `;
  }

  const [manualCollection] = await sql<{ id: number }[]>`
    INSERT INTO public.catalog_collections (
      filter_key, type, section, mode, title, position
    ) VALUES (
      'pl_test-classics', 'playlist', 'playlist', 'manual',
      'Testowe klasyki', 0
    ) RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.catalog_collections (
      filter_key, type, section, mode, title, active, position
    ) VALUES (
      'pl_inactive', 'playlist', 'playlist', 'manual',
      'Inactive', false, 1
    )
  `;
  await sql`
    INSERT INTO public.catalog_collections (
      filter_key, type, section, mode, title, position, rule_config
    ) VALUES (
      'st_test-style', 'style', 'style', 'rule', 'Testowy styl', 0,
      ${sql.json({ genre: "Test Style" })}
    )
  `;
  assert.ok(manualCollection);

  const items: Array<{ title: string; position: number; insertion: number }> = [];
  for (const [insertion, song] of insertedSongs.entries()) {
    const position = insertion % 4;
    await sql`
      INSERT INTO public.catalog_collection_items (
        collection_id, song_id, position
      ) VALUES (${manualCollection.id}, ${song.id}, ${position})
    `;
    items.push({ title: song.title, position, insertion });
  }
  const manualTitles = [...items]
    .sort(
      (left, right) =>
        left.position - right.position || left.insertion - right.insertion,
    )
    .map(({ title }) => title);

  return {
    firstToken,
    secondToken,
    scheduledToken,
    disabledToken,
    manualCollectionId: manualCollection.id,
    firstSongId: insertedSongs[0]!.id,
    manualTitles,
  };
}

async function assertRuntimeRoleAccess(sql: ReturnType<typeof createPostgresTestClient>) {
  const [rls] = await sql<{
    protectedTables: number;
    policies: number;
  }[]>`
    SELECT
      (SELECT count(*)::integer FROM pg_class
       WHERE oid IN ('public.catalog_collections'::regclass,
                     'public.catalog_collection_items'::regclass)
         AND relrowsecurity AND NOT relforcerowsecurity) AS "protectedTables",
      (SELECT count(*)::integer FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('catalog_collections', 'catalog_collection_items')) AS policies
  `;
  assert.deepEqual(rls, { protectedTables: 2, policies: 0 });

  const [grants] = await sql<{
    anonCollections: boolean;
    anonItems: boolean;
    authenticatedCollections: boolean;
  }[]>`
    SELECT
      has_table_privilege('anon', 'public.catalog_collections', 'SELECT') AS "anonCollections",
      has_table_privilege('anon', 'public.catalog_collection_items', 'SELECT') AS "anonItems",
      has_table_privilege('authenticated', 'public.catalog_collections', 'SELECT') AS "authenticatedCollections"
  `;
  assert.deepEqual(grants, {
    anonCollections: false,
    anonItems: false,
    authenticatedCollections: false,
  });

  await sql`
    CREATE ROLE catalog_runtime_probe
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN BYPASSRLS
  `;
  await sql`
    CREATE ROLE catalog_no_bypass_probe
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOBYPASSRLS
  `;
  await sql`GRANT USAGE ON SCHEMA public TO catalog_runtime_probe`;
  await sql`GRANT USAGE ON SCHEMA public TO catalog_no_bypass_probe`;
  await sql`
    GRANT SELECT ON public.catalog_collections, public.catalog_collection_items
    TO catalog_runtime_probe, catalog_no_bypass_probe
  `;
  const [role] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolsuper, rolbypassrls
    FROM pg_roles WHERE rolname = 'catalog_runtime_probe'
  `;
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: true });

  await sql.begin(async (transaction) => {
    await transaction`SET LOCAL ROLE catalog_runtime_probe`;
    const [counts] = await transaction<{ collections: number; items: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM public.catalog_collections) AS collections,
        (SELECT count(*)::integer FROM public.catalog_collection_items) AS items
    `;
    assert.deepEqual(counts, { collections: 3, items: 60 });
  });
  await sql.begin(async (transaction) => {
    await transaction`SET LOCAL ROLE catalog_no_bypass_probe`;
    const [counts] = await transaction<{ collections: number; items: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM public.catalog_collections) AS collections,
        (SELECT count(*)::integer FROM public.catalog_collection_items) AS items
    `;
    assert.deepEqual(counts, { collections: 0, items: 0 });
  });
}

async function assertDatabaseInvariants(
  sql: ReturnType<typeof createPostgresTestClient>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
) {
  const [collection] = await sql<{ publicId: string }[]>`
    SELECT public_id AS "publicId"
    FROM public.catalog_collections WHERE filter_key = 'pl_test-classics'
  `;
  assert.ok(collection);
  await assert.rejects(
    sql`UPDATE public.catalog_collections SET public_id = NULL WHERE filter_key = 'pl_inactive'`,
    hasSqlState("23502"),
  );
  await assert.rejects(
    sql`UPDATE public.catalog_collections SET public_id = ${collection.publicId} WHERE filter_key = 'pl_inactive'`,
    hasSqlState("23505"),
  );
  await assert.rejects(
    sql`UPDATE public.catalog_collections SET filter_key = 'pl_test-classics' WHERE filter_key = 'pl_inactive'`,
    hasSqlState("23505"),
  );

  for (const invalid of [
    { filter: "st_bad-manual", type: "style", section: "style", mode: "manual", config: null },
    { filter: "pl_bad-rule", type: "playlist", section: "playlist", mode: "rule", config: { genre: "Test Style" } },
    { filter: "pl_bad-style", type: "playlist", section: "style", mode: "manual", config: null },
    { filter: "st_bad-prefix", type: "playlist", section: "playlist", mode: "manual", config: null },
    { filter: "st_bad-sql", type: "style", section: "style", mode: "rule", config: { sql: "select *" } },
    { filter: "st_bad-null", type: "style", section: "style", mode: "rule", config: null },
    { filter: "st_bad-extra", type: "style", section: "style", mode: "rule", config: { genre: "Rock", sql: "select *" } },
    { filter: "st_bad-empty", type: "style", section: "style", mode: "rule", config: { genre: "  " } },
    { filter: "pl_bad-ranking", type: "playlist", section: "top", mode: "ranking", config: { sql: "select *" } },
  ]) {
    await assert.rejects(
      sql`
        INSERT INTO public.catalog_collections (
          filter_key, type, section, mode, title, position, rule_config
        ) VALUES (
          ${invalid.filter}, ${invalid.type}::catalog_collection_type,
          ${invalid.section}::catalog_collection_section,
          ${invalid.mode}::catalog_collection_mode,
          'Invalid', 0, ${sql.json(invalid.config)}
        )
      `,
      hasSqlState("23514"),
      invalid.filter,
    );
  }
  await assert.rejects(
    sql`
      INSERT INTO public.catalog_collections (
        filter_key, type, section, mode, title, position
      ) VALUES (
        'st_bad-sql-null', 'style', 'style', 'rule', 'Invalid', 0
      )
    `,
    hasSqlState("23514"),
  );
  await assert.rejects(
    sql`UPDATE public.catalog_collections SET position = -1 WHERE filter_key = 'pl_inactive'`,
    hasSqlState("23514"),
  );
  await assert.rejects(
    sql`
      INSERT INTO public.catalog_collection_items (collection_id, song_id, position)
      VALUES (${fixture.manualCollectionId}, ${fixture.firstSongId}, 1)
    `,
    hasSqlState("23505"),
  );
  await assert.rejects(
    sql`
      INSERT INTO public.catalog_collection_items (collection_id, song_id, position)
      VALUES (${fixture.manualCollectionId}, 9223372036854775807, 1)
    `,
    hasSqlState("23503"),
  );
  await assert.rejects(
    sql`
      UPDATE public.catalog_collection_items SET position = -1
      WHERE collection_id = ${fixture.manualCollectionId}
    `,
    hasSqlState("23514"),
  );
  await assert.rejects(
    sql`DELETE FROM public.songs WHERE id = ${fixture.firstSongId}`,
    hasSqlState("23503"),
  );
}

function hasSqlState(code: string) {
  return (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error &&
    error.code === code;
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
