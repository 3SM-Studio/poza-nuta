import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import { runSongPublicIdBackfill } from "../../src/db/backfill-song-public-id.ts";
import { createISingSongBatchWriter } from "../../src/db/ising-import-adapter.ts";
import { mapISingSongToSong } from "../../src/db/ising-mapping.ts";
import { mapKaraFunRowToSong } from "../../src/db/karafun-mapping.ts";
import { songs } from "../../src/db/schema.ts";
import {
  applyPostgresMigration,
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
} from "./postgresTestHarness.ts";

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("song public ID backfill orders batches by the numeric song ID", { timeout: 600_000 }, async () => {
  const harness = await startPostgresTestHarness("pozanuta-song-public-id-order", images[0]);
  const sql = createPostgresTestClient(harness, "postgres", 2);
  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, 25);
    await sql`
      INSERT INTO public.songs
        (id, source, source_song_id, public_id, title, artist,
         normalized_title, normalized_artist, search_text)
      OVERRIDING SYSTEM VALUE
      VALUES
        (2, 'karafun', 'numeric-2', NULL, 'Two', 'Artist', 'two', 'artist', 'artist two'),
        (10, 'karafun', 'numeric-10', NULL, 'Ten', 'Artist', 'ten', 'artist', 'artist ten'),
        (11, 'karafun', 'numeric-11', NULL, 'Eleven', 'Artist', 'eleven', 'artist', 'artist eleven'),
        (20, 'karafun', 'numeric-20', NULL, 'Twenty', 'Artist', 'twenty', 'artist', 'artist twenty')
    `;

    const result = await runSongPublicIdBackfill(sql, { batchSize: 2 });
    assert.ok(result.batches > 1);
    assert.equal(result.remainingNull, 0);

    const ids = await sql<{ id: string; public_id: string }[]>`
      SELECT id::text AS id, public_id::text AS public_id
      FROM public.songs
      ORDER BY public.songs.id
    `;
    assert.deepEqual(ids.map(({ id }) => id), ["2", "10", "11", "20"]);
    assert.equal(new Set(ids.map(({ public_id }) => public_id)).size, ids.length);
    ids.forEach(({ public_id }) => assert.match(public_id, uuidV4));

    const rerun = await runSongPublicIdBackfill(sql, { batchSize: 2 });
    assert.equal(rerun.updated, 0);
    assert.equal(rerun.remainingNull, 0);
  } finally {
    await sql.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
});

test("0025 expand and bounded backfill preserve song and request identity", { timeout: 1_200_000 }, async (context) => {
  for (const image of images) {
    await context.test(image, async () => {
      const harness = await startPostgresTestHarness("pozanuta-song-public-id", image);
      const sql = createPostgresTestClient(harness, "postgres", 2);
      try {
        await installPostgresCompatibilityFixture(sql);
        await applyPostgresMigrations(sql, 24);
        const legacy = await seedLegacySongsAndRequest(sql);
        await assert.rejects(runSongPublicIdBackfill(sql, { batchSize: 2 }), /expand schema/);

        await applyPostgresMigration(sql, 25);
        await assertExpandContract(sql);
        assert.deepEqual(await preservedSongs(sql), legacy.songs);
        assert.deepEqual(await preservedRequests(sql), legacy.requests);
        const [before] = await sql<{ missing: number }[]>`
          SELECT count(*)::integer AS missing FROM public.songs WHERE public_id IS NULL
        `;
        assert.equal(before.missing, legacy.songs.length);

        const db = drizzle({ client: sql });
        const karaPayload = mapKaraFunRowToSong({
          Id: "kara-new", Title: "KaraFun new", Artist: "Singer", Year: "2026",
          Duo: "0", Explicit: "0", "Date Added": "2026-09-17",
          Styles: "Pop", Languages: "Polish",
        });
        assert.ok(karaPayload);
        await db.insert(songs).values(karaPayload);
        const [karaNew] = await sql<{ public_id: string }[]>`
          SELECT public_id FROM public.songs WHERE source = 'karafun' AND source_song_id = 'kara-new'
        `;
        assert.match(karaNew.public_id, uuidV4);

        const isingWriter = createISingSongBatchWriter(db);
        const isingPayload = mapISingSongToSong({
          id: 9053, title: "iSing new", artist: "Singer", duration: 210,
          genre: ["Pop"], plus: false, hit: false,
        });
        assert.ok(isingPayload);
        assert.deepEqual(await isingWriter([isingPayload]), { inserted: 1, updated: 0 });
        const [isingNew] = await sql<{ public_id: string }[]>`
          SELECT public_id FROM public.songs WHERE source = 'ising' AND source_song_id = '9053'
        `;
        assert.match(isingNew.public_id, uuidV4);
        assert.deepEqual(
          await isingWriter([{ ...isingPayload, title: "iSing updated" }]),
          { inserted: 0, updated: 1 },
        );
        const [isingUpdated] = await sql<{ public_id: string; title: string }[]>`
          SELECT public_id, title FROM public.songs WHERE source = 'ising' AND source_song_id = '9053'
        `;
        assert.equal(isingUpdated.public_id, isingNew.public_id);
        assert.equal(isingUpdated.title, "iSing updated");

        // KaraFun's writer lives inside its eager CLI, so this SQL verifies
        // database conflict behavior without claiming production writer coverage.
        await sql`
          INSERT INTO public.songs
            (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text)
          VALUES ('karafun', 'kara-new', 'KaraFun updated', 'Singer', 'karafun updated', 'singer', 'singer karafun updated')
          ON CONFLICT (source, source_song_id) WHERE source_song_id IS NOT NULL
          DO UPDATE SET title = excluded.title, artist = excluded.artist,
            normalized_title = excluded.normalized_title,
            normalized_artist = excluded.normalized_artist,
            search_text = excluded.search_text
        `;
        const [karaUpdated] = await sql<{ public_id: string; title: string }[]>`
          SELECT public_id, title FROM public.songs WHERE source = 'karafun' AND source_song_id = 'kara-new'
        `;
        assert.equal(karaUpdated.public_id, karaNew.public_id);
        assert.equal(karaUpdated.title, "KaraFun updated");

        const blocker = createPostgresTestClient(harness, "postgres", 1);
        let signalLocked!: () => void;
        let releaseLock!: () => void;
        const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
        const release = new Promise<void>((resolve) => { releaseLock = resolve; });
        const holding = blocker.begin(async (transaction) => {
          await transaction`SELECT id FROM public.songs WHERE source_song_id = 'kara-1' FOR UPDATE`;
          signalLocked();
          await release;
        });
        await locked;
        const releaseTimer = setTimeout(releaseLock, 2_300);
        let insertedBetweenBatches = false;
        let result;
        try {
          result = await runSongPublicIdBackfill(sql, {
            batchSize: 2,
            onBatch: async () => {
              if (insertedBetweenBatches) return;
              insertedBetweenBatches = true;
              const [fresh] = await sql<{ public_id: string }[]>`
                INSERT INTO public.songs
                  (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text)
                VALUES ('karafun', 'between-batches', 'Between', 'Singer', 'between', 'singer', 'singer between')
                RETURNING public_id
              `;
              assert.match(fresh.public_id, uuidV4);
              // A concurrent writer can create a NULL below the current keyset cursor.
              // The final count must force a new pass beginning at the first ID.
              await sql`UPDATE public.songs SET public_id = NULL WHERE source_song_id = 'kara-1'`;
            },
          });
        } finally {
          clearTimeout(releaseTimer);
          releaseLock();
          await holding;
          await blocker.end({ timeout: 5 });
        }
        assert.equal(result.updated, legacy.songs.length + 1);
        assert.equal(result.processed, result.updated);
        assert.ok(result.batches > 1);
        assert.ok(result.retries >= 1);
        assert.equal(result.remainingNull, 0);
        assert.deepEqual(await preservedSongs(sql), legacy.songs);
        assert.deepEqual(await preservedRequests(sql), legacy.requests);
        const allIds = await sql<{ public_id: string }[]>`SELECT public_id FROM public.songs`;
        assert.equal(new Set(allIds.map(({ public_id }) => public_id)).size, allIds.length);
        allIds.forEach(({ public_id }) => assert.match(public_id, uuidV4));

        const rerun = await runSongPublicIdBackfill(sql, { batchSize: 2 });
        assert.equal(rerun.updated, 0);
        assert.equal(rerun.remainingNull, 0);

        await sql`ALTER TABLE public.songs ALTER COLUMN public_id DROP DEFAULT`;
        await assert.rejects(runSongPublicIdBackfill(sql), /expand schema/);
      } finally {
        await sql.end({ timeout: 5 });
        await removePostgresTestHarness(harness.containerName);
      }
    });
  }
});

async function seedLegacySongsAndRequest(sql: postgres.Sql) {
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Song ID test', 'song-id-test', 'songpublicidtest0000') RETURNING id::integer
  `;
  const [event] = await sql<{ id: number }[]>`
    INSERT INTO public.events (workspace_id, name, starts_at, ends_at)
    VALUES (${workspace.id}, 'Song ID test', now(), now() + interval '8 hours')
    RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.songs
      (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text)
    VALUES
      ('karafun', 'kara-1', 'First title', 'First artist', 'first title', 'first artist', 'first artist first title'),
      ('ising', 'ising-1', 'Second title', 'Second artist', 'second title', 'second artist', 'second artist second title'),
      ('karafun', 'kara-2', 'Third title', 'Third artist', 'third title', 'third artist', 'third artist third title'),
      ('ising', 'ising-2', 'Fourth title', 'Fourth artist', 'fourth title', 'fourth artist', 'fourth artist fourth title'),
      ('karafun', 'kara-3', 'Fifth title', 'Fifth artist', 'fifth title', 'fifth artist', 'fifth artist fifth title')
  `;
  const [song] = await sql<{ id: number }[]>`SELECT id::integer FROM public.songs ORDER BY id LIMIT 1`;
  await sql`
    INSERT INTO public.song_requests
      (event_id, song_id, singer_name, display_name, position, requested_by)
    VALUES (${event.id}, ${song.id}, 'Test singer', 'Test singer', 0, 'public')
  `;
  return { songs: await preservedSongs(sql), requests: await preservedRequests(sql) };
}

async function preservedSongs(sql: postgres.Sql) {
  return Array.from(await sql`
    SELECT id, source, source_song_id, title, artist FROM public.songs WHERE id <= 5 ORDER BY id
  `);
}

async function preservedRequests(sql: postgres.Sql) {
  return Array.from(await sql`
    SELECT id, event_id, song_id, singer_name, display_name, position, requested_by
    FROM public.song_requests ORDER BY id
  `);
}

async function assertExpandContract(sql: postgres.Sql) {
  const [state] = await sql<{
    column_default: string;
    is_nullable: string;
    data_type: string;
    unique_index: string | null;
  }[]>`
    SELECT c.column_default, c.is_nullable, c.data_type,
           to_regclass('public.songs_public_id_idx')::text AS unique_index
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'songs' AND c.column_name = 'public_id'
  `;
  assert.deepEqual(state, {
    column_default: "gen_random_uuid()", is_nullable: "YES",
    data_type: "uuid", unique_index: null,
  });
}
