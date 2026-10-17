# Fuzzy distance index 0034 — rollout proposal

No remote migration, backfill, flag change or deployment is authorized by this
runbook. Execute only after separate owner approval and current target/backup
verification. Preserve the existing Vercel project, domains and aliases.

## Objects and compatibility

`0034_song_search_fuzzy_distance.sql` creates one additive GiST index on
`public.song_search_documents ((search_text || '') gist_trgm_ops(siglen=256))`.
It adds no tables/columns, rewrites no songs, changes no grants or RLS policies,
and needs no application data backfill. Existing rows are included by CREATE INDEX.
The existing 0031 projection trigger maintains it for source inserts/upserts/updates.
The expression isolates this index from existing plain-column GIN literal plans.

Multi-token fuzzy uses the same `%>>` predicate at threshold 0.5, followed by
distance ascending, exact strict similarity descending, and original song ID.
Distance is one minus strict similarity and is monotonic. The secondary exact
score protects the original order even when float4 distances round to a tie.
Single-token queries retain the original plan, avoiding the measured dense-tie
regression. Candidate limit 200, strong-fill threshold 100, final ranking tiers,
aliases, normalized keys, page size and cursor v2 are unchanged.

The previous application ignores this expression index and continues to work.
New SQL is functionally correct without it but can be slower. Therefore deploy
the new application only after verifying the index. Do not rely on deploying
code first or on an implicit remote `drizzle-kit push`.

## Preflight — read only

1. Confirm the active alias/deployment and project `pozanuta`; verify the database
   connection independently matches authorized ref `qwmimnhdnzqfckswxjww`.
2. Verify PostgreSQL 17, pg_trgm version/schema, function/operator resolution,
   migration history/hashes through the currently deployed schema, and whether
   0032/0033 from the integrated checkpoint are already applied. This run does not
   assert production has them. Do not skip pending migrations out of journal order.
3. Verify the approved backup is current and restorable. Do not modify the existing
   encrypted backup. Record a separate restore verification if required for release.
4. Verify source/projection row counts, missing/stale normalization-v2 projections,
   catalog-import activity, free storage, database/role limits and index-name absence.
   Verify the runtime role can execute pg_catalog.pg_try_advisory_xact_lock(integer,integer);
   do not grant privileges automatically if it cannot.
   The synthetic 92k test used roughly 19 MiB for the new index; this is not a
   guarantee for the real catalog or a measurement of production free disk.
5. Inspect locks/long transactions with safe aggregates. Pause/reschedule catalog
   imports before the approved schema window; active karaoke requests/queue updates
   do not write the song-search projection. Do not run expensive EXPLAIN ANALYZE or
   a load generator against production.

## Applying after approval

Use the repository's reviewed migration runner/history procedure, not ad-hoc ALTER
or schema push. The generated index build is transactional, **not CONCURRENTLY**.
It permits catalog reads but takes a SHARE lock on the projection, which blocks
catalog writes/trigger updates until commit. Local build time is not a production
lock-duration promise. Do not let a short web-request statement timeout silently
serve as the migration runner's resource budget. Set an explicitly reviewed
migration lock/statement budget, retain the runner's nonzero failure, and stop on
failure without marking the migration applied.

If a production maintenance window cannot tolerate this lock, stop this rollout
and separately approve a migration plan that builds concurrently outside a
transaction, validates the index, and safely reconciles Drizzle history. Do not
silently replace this migration with an untracked concurrent command.

After commit verify:

```sql
SELECT i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid),
       pg_relation_size(i.indexrelid)
FROM pg_index i
WHERE i.indexrelid = 'public.song_search_documents_fuzzy_distance_idx'::regclass;
```

Also verify unchanged source counts, projection freshness, exact migration hash
and role grants. A small isolated clone may choose a sequential scan; the 92k
benchmark must show the intended GiST KNN path. Use only plain EXPLAIN, or the
approved bounded production smoke, for hosted preflight.

Deploy only the approved integrated application image after these gates. Keep
the existing production URL. Test the search in a separate approved test event,
including Unicode PL/EN/UK, typo queries, page two, search recovery, imports and
queue/realtime coexistence. No test event was created on production in this task.

## Abort and recovery

- Failed transactional index creation rolls back; check the index and migration
  journal before retry. Do not advance the journal manually to hide failure.
- A validated index may safely remain when reverting the application deployment.
  No table/data rollback is required. Previous SQL cannot accidentally choose the
  expression index for its plain `search_text` predicates.
- If storage or write cost requires removal, obtain separate approval before
  dropping only this derived index. A local recovery test drops/rebuilds it in an
  owned disposable database and verifies old/new code still reads the same data.
- Existing `SONG_SEARCH_ENGINE=legacy` is a separate controlled fallback. It loses
  original-script Unicode coverage and invalidates pending cursors; it is not a
  substitute for preserving the new index during an application rollback.
- Do not destructively roll back migrations 0028–0033, reset queues, alter event
  identities, or run a production backfill in response to an index problem.

## Shared admission

The final application also uses two database-wide transaction advisory slots for
catalog searches; see `../architecture/adr-song-search-capacity.md`. Busy attempts
release the transaction/connection before bounded application backoff. A 6s
admission budget is separate from, and does not increase, the 2s Unicode SQL
statement limit. Original code bypasses these slots during a rolling transition;
wait for old invocations to drain before evaluating the new steady state.

Admission adds cheap SQL attempts under contention. A lower count of expensive
ranking statements is not a promise that the total SQL statement count always
decreases. Validate region latency (active Vercel deployment reports iad1), role
permissions and hosted resources. The two-CPU-quota benchmark is not evidence
of the actual Supabase plan, location or network latency.

## Monitoring

Schedule large catalog imports outside live-event smoke/load windows unless their
coexistence is explicitly validated on the hosted resource budget. Admission caps
searches, not importer/category/background CPU.

Compare error rates by engine/route, DB statement timeout versus lock timeout,
search duration, connection pressure, catalog-import latency, cache refresh and
429 rate. Search execution telemetry logs only semantic operation names, safe
classifications and timing/correlation IDs; no query values or session tokens.
Shared in-flight executions have one execution trace, not one trace per waiter.
Stop release expansion on recurrence of 57014, unexpected ranking differences,
projection drift, queue regressions or widespread venue-NAT 429 responses.
