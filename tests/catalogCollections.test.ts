import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isCatalogCollectionFilterKey,
  isPlaylistCollectionFilterKey,
  isStyleCollectionFilterKey,
  parseCatalogCollectionRuleConfig,
} from "../src/lib/catalog-collections.ts";
import { assertLocalCatalogFixtureTarget } from "../src/db/catalog-fixture-target.ts";
import {
  encodeCatalogCollectionCursor,
  validateCatalogCollectionBrowseQuery,
  validateCatalogCollectionListQuery,
} from "../src/server/session-api/validation.ts";

test("catalog filter keys use stable typed public prefixes", () => {
  for (const value of [
    "pl_top-us",
    "pl_karaoke-classics",
    "pl_test-classics",
    "st_soul",
    "st_test-style",
  ]) {
    assert.equal(isCatalogCollectionFilterKey(value), true, value);
  }

  for (const value of [
    "1",
    "pl_1_2",
    "st_",
    "PL_top-us",
    "playlist_top",
    "pl_top us",
    "pl_top/../admin",
  ]) {
    assert.equal(isCatalogCollectionFilterKey(value), false, value);
  }

  assert.equal(isPlaylistCollectionFilterKey("pl_top-us"), true);
  assert.equal(isPlaylistCollectionFilterKey("st_soul"), false);
  assert.equal(isStyleCollectionFilterKey("st_soul"), true);
  assert.equal(isStyleCollectionFilterKey("pl_top-us"), false);
});

test("catalog collection validation binds a 50-row cursor to its filter", () => {
  assert.deepEqual(
    validateCatalogCollectionListQuery(new URLSearchParams({ section: "top" })),
    { success: true, data: { section: "top" } },
  );
  assert.equal(
    validateCatalogCollectionListQuery(
      new URLSearchParams({ section: "workspace" }),
    ).success,
    false,
  );

  const firstPage = validateCatalogCollectionBrowseQuery(
    new URLSearchParams({ filter: "pl_test-classics" }),
  );
  assert.deepEqual(firstPage, {
    success: true,
    data: { filterKey: "pl_test-classics", limit: 50, cursor: null },
  });

  const cursor = encodeCatalogCollectionCursor({
    version: 1,
    filterKey: "pl_test-classics",
    mode: "manual",
    songId: 19,
  });
  const nextPage = validateCatalogCollectionBrowseQuery(
    new URLSearchParams({
      filter: "pl_test-classics",
      limit: "50",
      cursor,
    }),
  );
  assert.equal(nextPage.success, true);
  if (nextPage.success) {
    assert.equal(nextPage.data.cursor?.mode, "manual");
    if (nextPage.data.cursor?.mode === "manual") {
      assert.equal(nextPage.data.cursor.songId, 19);
    }
  }

  assert.equal(
    validateCatalogCollectionBrowseQuery(
      new URLSearchParams({ filter: "pl_other", cursor }),
    ).success,
    false,
  );
  assert.equal(
    validateCatalogCollectionBrowseQuery(
      new URLSearchParams({ filter: "pl_test-classics", limit: "51" }),
    ).success,
    false,
  );
  assert.equal(
    validateCatalogCollectionBrowseQuery(
      new URLSearchParams({ filter: "123" }),
    ).success,
    false,
  );
});

test("style rules accept only the typed genre config", () => {
  assert.deepEqual(parseCatalogCollectionRuleConfig({ genre: " Rock " }), {
    genre: "rock",
  });
  assert.equal(parseCatalogCollectionRuleConfig({ sql: "select *" }), null);
  assert.equal(
    parseCatalogCollectionRuleConfig({ genre: "Rock", where: "raw" }),
    null,
  );
  assert.equal(parseCatalogCollectionRuleConfig({ genre: "" }), null);
});

test("catalog fixture seed refuses non-local database targets", () => {
  assert.doesNotThrow(() =>
    assertLocalCatalogFixtureTarget(
      "postgresql://postgres:placeholder@127.0.0.1:54322/postgres",
    ),
  );
  assert.doesNotThrow(() =>
    assertLocalCatalogFixtureTarget(
      "postgresql://postgres:placeholder@localhost:5432/postgres",
    ),
  );
  assert.throws(
    () =>
      assertLocalCatalogFixtureTarget(
        "postgresql://postgres:placeholder@db.example.supabase.co:5432/postgres",
      ),
    /local development database/,
  );
});

test("collection UI reuses the existing song details and request flow", () => {
  const page = readFileSync(
    "src/components/public/session-request-page.tsx",
    "utf8",
  );
  const collectionView = page.slice(
    page.indexOf('displayedCatalogView.kind === "collections"'),
    page.indexOf('displayedCatalogView.kind === "catalog"'),
  );

  assert.match(collectionView, /<CatalogCollectionSongList/);
  assert.match(collectionView, /onSongSelect=\{selectSong\}/);
  assert.equal((page.match(/<SongDetailsDrawer/g) ?? []).length, 1);
  assert.match(page, /await createSessionRequest\(sessionToken, \{ songId: selectedSong\.id \}\)/);
});
