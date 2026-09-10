# Migration 0024: public song request identifiers

## Purpose

Adds a non-sequential UUID to every `song_requests` row so participant-facing APIs never expose the internal bigint identifier.

## Rollout

1. Add the nullable `public_id` column.
2. Temporarily disable only the queue broadcast trigger, backfill every existing row with `gen_random_uuid()`, and immediately enable that trigger again. This prevents technical UUID updates from invalidating every live queue.
3. Abort if any row remains without an identifier.
4. Add the default, `NOT NULL`, and the unique index.

The migration is forward-only and preserves legacy and operator-created requests.

## Lock and write impact

The backfill updates every existing `song_requests` row. The subsequent
`SET NOT NULL` validation and non-concurrent unique index creation can hold
table locks and temporarily delay request writes while the migration
transaction is open. For the current small table this should be brief, but if
the table grows, run the migration in a controlled low-traffic window and
observe write latency until it commits.

Before rollout, record the row count and verify that the queue broadcast
trigger exists. After rollout, run all verification queries below and confirm
that ordinary request creation still succeeds before ending the maintenance
window.

## Verification

```sql
select count(*) from public.song_requests where public_id is null;
select public_id, count(*) from public.song_requests group by public_id having count(*) > 1;
select tgenabled from pg_trigger where tgname = 'song_requests_broadcast_queue_changed_trigger';
select count(*) from public.song_requests;
```

The first count must be `0`, the duplicate query must return no rows, and `tgenabled` must be `O` (enabled).

## Rollback / forward fix

Do not drop identifiers after participant links may have been returned. The
Drizzle migration transaction rolls back the column, backfill, and temporary
trigger state together if a statement fails. Diagnose the failed statement and
ship a forward fix; do not edit migration 0024 after it has been applied in any
shared environment. If the unique index cannot be created, verify nulls and
duplicates, replace only invalid or duplicate UUIDs, and create the constraint
in the forward-fix migration. Re-run the trigger and row-count checks after the
fix.
