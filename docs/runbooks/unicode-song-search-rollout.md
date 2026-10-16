# Unicode search v2: migration, backfill and rollback

Status: proposed procedure, not execution approval. No remote commands were run in final recovery. Production/Preview changes require separate owner approval. See [implementation and evidence](../features/universal-multilingual-song-search.md) and [ADR](../architecture/adr-unicode-song-search.md).

## Gates before any write

1. Record the approved environment and database identity without logging its connection string. Verify that application, migration, importer and verification roles resolve to that same intended target. Never infer the target from a localhost application URL.
2. Verify backup and a tested restore procedure, current migration journal hashes/timestamps, PostgreSQL 17, UTF-8 and `pg_trgm`. A clean isolated PG17 reconstruction is already tested; the actual target's history still needs independent verification. Do not substitute `drizzle-kit push` for the migration journal.
3. Keep `SONG_SEARCH_ENGINE=legacy`. Verify the actual application runtime reports Unicode `17.0`; selecting v2 on another runtime intentionally fails closed. Confirm provider imports retain legacy keys for rollback.
4. Estimate derived-table/index disk growth, WAL, trigger cost and concurrent import load using an approved representative catalog. Inspect worst-case title/artist lengths and normalized B-tree key sizes: no truncation or destructive replacement is supplied. Obtain a latency budget and test broad queries, PL/EN typo quality and common CJK characters. Synthetic measurements alone do not close this gate.
5. Approve the migration and backfill separately for the verified target. The existing developer CLI only accepts owned loopback targets and must not gain a remote override. A future remote runner requires explicit authorization, target guards, bounded transactions and safe logs; no such runner is provided here.

## Expand and backfill

Apply `drizzle/0031_unicode_song_search.sql` through the normal journal on the approved target. It creates private derived tables `song_search_documents` and `song_search_aliases`, indexes, pinned Unicode functions and source/alias triggers. Existing source rows are untouched; indexes start on empty derived tables. Verify the transaction and journal completed before proceeding. Stop on a migration error; do not manually advance the journal.

Verify the application role can SELECT the derived tables. Restricted importer roles require their existing source INSERT/UPDATE rights; the fixed-search-path SECURITY DEFINER trigger writes the projection. Do not grant helper execution or derived-table access to browser roles. Test the actual importer role in an isolated environment before cutover.

Use `backfillUnicodeSongSearchBatch` in short transactions: default 250 source rows, maximum 1,000, source `FOR UPDATE SKIP LOCKED`, 1-second lock timeout, 30-second statement timeout. It inserts/upserts only selected missing version-2 documents, never source songs or aliases. Commit each successful batch. A failed transaction rolls back that batch; rerun safely. Concurrent source edits serialize on source locks, and future imports update the projection transactionally through the trigger.

For an already approved owned local target only, the developer command is `pnpm exec tsx scripts/backfill-unicode-song-search.ts` with `UNICODE_SEARCH_LOCAL_DATABASE_URL` supplied securely by the approved local runner. Do not paste a connection string into the command log, copy production credentials or load a cloud `.env` file. This command does not authorize a new target or write operation.

Track rows written, remaining missing rows, errors and timings without dumping source data. An empty SKIP LOCKED batch can mean another worker holds the remaining rows: completion requires a fresh zero-missing check after writers settle. The CLI reports missing rows and fails if any remain. Interrupted batches are resumed by rerunning; already completed rows are skipped.

## Read-only verification before cutover

Run with an approved verification role; do not expose credentials or source titles in output.

```sql
SELECT current_setting('server_version_num'), current_setting('server_encoding');
SELECT count(*) AS missing
FROM public.songs s WHERE NOT EXISTS (
  SELECT 1 FROM public.song_search_documents d
  WHERE d.song_id=s.id AND d.normalization_version=2
);
SELECT count(*) AS mismatched
FROM public.song_search_documents d JOIN public.songs s ON s.id=d.song_id
WHERE d.normalized_title <> public.kunestu_search_normalize_v2(s.title)
   OR d.normalized_artist <> public.kunestu_search_normalize_v2(s.artist)
   OR d.search_text <> public.kunestu_search_normalize_v2(concat_ws(' ',
        s.title, s.artist, s.search_text, array_to_string(s.genres,' '), array_to_string(s.languages,' ')))
   OR d.short_grams <> public.kunestu_search_grams_v2(d.search_text);
SELECT count(*) AS invalid_alias_keys FROM public.song_search_aliases a
WHERE a.normalized_value <> public.kunestu_search_normalize_v2(a.value)
   OR a.short_grams <> public.kunestu_search_grams_v2(a.normalized_value);
SELECT max(octet_length(normalized_title)) AS title_key_bytes,
       max(octet_length(normalized_artist)) AS artist_key_bytes
FROM public.song_search_documents;
SELECT relname, relrowsecurity FROM pg_class
WHERE oid IN ('public.song_search_documents'::regclass,'public.song_search_aliases'::regclass);
SELECT has_table_privilege('anon','public.song_search_documents','SELECT') AS anon_documents,
       has_table_privilege('authenticated','public.song_search_aliases','SELECT') AS authenticated_aliases,
       has_function_privilege('anon','public.kunestu_search_normalize_v2(text)','EXECUTE') AS anon_helper;
```

Expected: missing/mismatched/invalid aliases zero; both RLS flags true; browser privileges false. Full mismatch scans can be expensive: schedule them with a reviewed timeout/load budget. Compare source row counts, IDs, provider identities, original titles/artists and legacy keys against approved pre-migration evidence; projection row counts alone cannot prove source preservation. Check trigger existence/enabled state and alias provenance. A mismatch blocks cutover; the supplied backfill only repairs **missing** documents, not already existing stale/corrupt ones.

On the same approved isolated catalog, verify original-script exact/prefix/substring, short CJK, numeric tokens, aliases, PL/EN typo rankings, pagination and broad/concurrent queries. Confirm plans and latency against the agreed budget. Obtain real provider recall evidence; provider data was not available for this task. Verify PL/EN/UK return identical ordered IDs and preserve original strings, session identity, request limits, capability/RBAC and Realtime behavior. Do not generate synthetic requests in production.

## Cutover and monitoring

Only after approval and all gates, enable `SONG_SEARCH_ENGINE=unicode-v2` through the approved deployment process. New search cursors are version 2; old search cursors must restart at page one. This does not rotate session URLs, QR codes, participant tokens or request IDs. Observe query errors/timeouts, tail latency, pool health, CPU/IO, import duration and derived-row freshness. Roll back reads if the agreed budget or correctness gate fails.

## Safe rollback

Return `SONG_SEARCH_ENGINE` to `legacy` through the approved configuration/deployment procedure and restart/refetch searches. This requires separate approval; this document performs no configuration or deployment change. Keep the journal, additive tables, functions, aliases, triggers and all original source data. Legacy import keys remain maintained. In-flight cursors may need page-one retries.

This is a **read-path rollback**, not removal of the write overhead. If triggers themselves cause unacceptable write cost, stop and prepare a separately approved forward-fix/reconciliation plan. Do not disable/drop them as an automatic rollback step. Source edits made while triggers are disabled leave existing documents stale, and the missing-only backfill will not repair them. Re-enabling v2 then requires a reviewed refresh of those documents plus full mismatch verification. Never delete/truncate/reset `songs`, overwrite original titles, remove catalog IDs or mark migrations unapplied as a shortcut.
