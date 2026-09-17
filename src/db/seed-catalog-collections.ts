import { config } from "dotenv";
import { asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { requireAdminDatabaseUrl } from "./admin-database-url.ts";
import { assertLocalCatalogFixtureTarget } from "./catalog-fixture-target.ts";
import { logDatabaseError } from "./log-db-error.ts";
import {
  catalogCollectionItems,
  catalogCollections,
  songs,
} from "./schema.ts";

config({ path: [".env.local", ".env"], quiet: true });

async function seedCatalogCollections() {
  const databaseUrl = requireAdminDatabaseUrl();
  assertLocalCatalogFixtureTarget(databaseUrl);

  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 1,
    prepare: false,
  });
  const db = drizzle({ client });

  try {
    const songRows = await db
      .select({ id: songs.id, genres: songs.genres })
      .from(songs)
      .orderBy(asc(songs.id))
      .limit(200);
    const manualSongs = songRows.slice(0, 55);
    const fixtureGenre = songRows
      .flatMap((song) => song.genres)
      .map((genre) => genre.trim())
      .find(Boolean);

    await db.transaction(async (transaction) => {
      const [manualCollection] = await transaction
        .insert(catalogCollections)
        .values({
          filterKey: "pl_test-classics",
          type: "playlist",
          section: "playlist",
          mode: "manual",
          title: "Testowe klasyki",
          description: "Lokalna kolekcja do testowania publicznego flow.",
          position: 0,
        })
        .onConflictDoUpdate({
          target: catalogCollections.filterKey,
          set: {
            active: true,
            title: "Testowe klasyki",
            description: "Lokalna kolekcja do testowania publicznego flow.",
            position: 0,
            updatedAt: new Date(),
          },
        })
        .returning({ id: catalogCollections.id });

      if (!manualCollection) {
        throw new Error("Manual catalog collection fixture was not created.");
      }

      if (manualSongs.length > 0) {
        await transaction
          .insert(catalogCollectionItems)
          .values(
            manualSongs.map((song, position) => ({
              collectionId: manualCollection.id,
              songId: song.id,
              position,
            })),
          )
          .onConflictDoUpdate({
            target: [
              catalogCollectionItems.collectionId,
              catalogCollectionItems.songId,
            ],
            set: { position: sql`excluded.position` },
          });
      }

      await transaction
        .insert(catalogCollections)
        .values({
          filterKey: "st_test-style",
          type: "style",
          section: "style",
          mode: "rule",
          title: "Testowy styl",
          description: "Lokalna kolekcja regułowa do testowania publicznego flow.",
          position: 0,
          ruleConfig: {
            genre: fixtureGenre ?? "__test_style_without_catalog_matches__",
          },
        })
        .onConflictDoUpdate({
          target: catalogCollections.filterKey,
          set: {
            active: true,
            title: "Testowy styl",
            description:
              "Lokalna kolekcja regułowa do testowania publicznego flow.",
            ruleConfig: {
              genre: fixtureGenre ?? "__test_style_without_catalog_matches__",
            },
            position: 0,
            updatedAt: new Date(),
          },
        });
    });

    console.log(
      `Catalog collection fixtures are ready (${manualSongs.length} manual songs, style genre: ${fixtureGenre ?? "no local genre"}).`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

seedCatalogCollections().catch((error: unknown) => {
  logDatabaseError("Catalog collection fixture seed failed", error);
  process.exitCode = 1;
});
