# Migration 0025: song public identity expand

## Purpose and rollout

This is phase A of a multi-phase rollout. Migration `0025_absurd_nemesis.sql` adds `songs.public_id` as **nullable UUID** and then sets `DEFAULT gen_random_uuid()`. It does not update existing songs, create a unique index, or set `NOT NULL`. Existing rows remain NULL; new KaraFun and iSing inserts that omit the column receive a UUID from PostgreSQL. Their production upserts do not assign `public_id`.

After a separately approved application of phase A, phase B runs `pnpm db:backfill:song-public-id --expected-project-ref <approved-ref> --batch-size 1000` with `DIRECT_URL`. The required project ref must match the Supabase direct host or pooler username in `DIRECT_URL`; verify the intended environment separately before running the command. It selects NULL rows by bigint ID, locks at most one batch of rows, updates only `public_id`, commits, and verifies the remaining NULL count. The command can be restarted; already identified rows are untouched. It has bounded lock and statement timeouts and limited retries for transient conflicts. A final verification pass restarts the keyset scan if concurrent activity left NULL rows behind. It fails rather than reporting success while NULLs remain.

Phase C is a future milestone after live backfill: verify no NULLs or duplicates, establish uniqueness, and enforce `NOT NULL` with a short final lock. Until phase C is complete, portable identity is incomplete and consumers must not assume every song has a public ID.

## Lock behavior

The Drizzle migrator executes pending statements in one transaction. The nullable `ADD COLUMN` and `SET DEFAULT` therefore hold their `ACCESS EXCLUSIVE` lock until phase A commits. Phase A contains no table-wide backfill or index build. The previous single-transaction design took about 5.30 seconds on 92,014 synthetic songs and blocked `SELECT`, `INSERT`, and `UPDATE` for about 5.2 seconds. Phase B runs outside the migrator, with one transaction per bounded row batch and no relation-wide `ACCESS EXCLUSIVE` lock. A writer targeting a selected row can still wait up to the batch lock timeout.

## Verification in an approved environment

After phase A:

```sql
SELECT data_type, is_nullable, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'songs' AND column_name = 'public_id';
SELECT count(*) AS songs, count(*) FILTER (WHERE public_id IS NULL) AS remaining_null
FROM public.songs;
SELECT to_regclass('public.songs_public_id_idx');
```

Expect `uuid`, `YES`, `gen_random_uuid()`, existing NULLs, and no public-ID index. After phase B, the command must report `remainingNull=0`; independently run:

```sql
SELECT count(*) FROM public.songs WHERE public_id IS NULL;
SELECT public_id, count(*) FROM public.songs
WHERE public_id IS NOT NULL GROUP BY public_id HAVING count(*) > 1;
SELECT count(*) FROM public.song_requests r
LEFT JOIN public.songs s ON s.id = r.song_id WHERE s.id IS NULL;
```

The NULL and orphan counts must be zero and the duplicate query empty before phase C. Compare song counts, bigint IDs, source identity and request counts with pre-rollout records. Run a new-song insert and source upsert smoke in an isolated environment before live rollout.

## Recovery and limits

If phase A fails, its transaction rolls back. If phase B stops, rerun the command; it updates only NULL rows. Investigate schema-guard or retry-limit failures before resuming. Do not regenerate IDs already assigned. A later shared-environment correction requires a new forward migration, not an edit to an applied 0025. Neither phase is applied to a live database in this milestone; no deploy or importer run is included.
