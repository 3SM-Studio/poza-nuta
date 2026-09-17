import assert from "node:assert/strict";
import test from "node:test";

import { createLibraryExportDataSource } from "../../src/server/platform-admin/library-export-store.ts";
import {
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
} from "./postgresTestHarness.ts";

test("library export cursor returns every colliding song exactly once across batches", { timeout: 600_000 }, async () => {
  const harness = await startPostgresTestHarness("pozanuta-library-export");
  const sql = createPostgresTestClient(harness, "postgres", 2);
  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, 25);
    await sql`
      INSERT INTO public.songs
        (id, public_id, source, source_song_id, title, artist,
         normalized_title, normalized_artist, search_text)
      OVERRIDING SYSTEM VALUE
      VALUES
        (9007199254740995, '11111111-1111-4111-8111-111111111111', 'karafun', NULL,
         'Null later', 'Duplicate artist', 'duplicate title', 'duplicate artist', 'duplicate artist duplicate title'),
        (9007199254740993, '22222222-2222-4222-8222-222222222222', 'karafun', NULL,
         'Null earlier', 'Duplicate artist', 'duplicate title', 'duplicate artist', 'duplicate artist duplicate title'),
        (10, '33333333-3333-4333-8333-333333333333', 'karafun', 'shared-source-id',
         'KaraFun shared', 'Duplicate artist', 'duplicate title', 'duplicate artist', 'duplicate artist duplicate title'),
        (20, '44444444-4444-4444-8444-444444444444', 'ising', 'shared-source-id',
         'iSing shared', 'Duplicate artist', 'duplicate title', 'duplicate artist', 'duplicate artist duplicate title'),
        (11, '55555555-5555-4555-8555-555555555555', 'karafun', 'last',
         'Different artist', 'Later artist', 'later title', 'later artist', 'later artist later title')
    `;

    const batches = [];
    for await (const batch of createLibraryExportDataSource({
      $client: sql,
    }).readSongBatches(2)) {
      batches.push(batch);
    }

    assert.ok(batches.length > 1);
    assert.ok(batches.every((batch) => batch.length <= 2));
    const exported = batches.flat();
    const publicIds = exported.map(({ publicId }) => publicId);
    assert.equal(exported.length, 5);
    assert.equal(new Set(publicIds).size, 5);
    assert.deepEqual(publicIds, [
      "44444444-4444-4444-8444-444444444444",
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
      "55555555-5555-4555-8555-555555555555",
    ]);
  } finally {
    await sql.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
});
