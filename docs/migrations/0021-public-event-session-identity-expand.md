# Migration 0021: public event session identity expand

## Purpose

This expand migration adds stable public UUIDs for dashboard event routes, one
durable session identity per event, and rotatable short-code history. It does
not apply the future 0022 recycling contract and does not remove
`events.session_code` or its unique index.

## Required release order

1. Enter a maintenance/write-freeze window for every process that can create,
   close, extend, reopen, or mutate events and their queues.
2. Stop and drain old application instances and import-independent event
   writers.
3. Take a PostgreSQL 17 custom-format backup of `public`, `private`, and
   `drizzle` and complete a full restore rehearsal.
4. Run all read-only preflight queries below.
5. Apply migration 0021 exactly once.
6. Run all post-migration verification.
7. Deploy the code that atomically creates session identities, dual-writes the
   current code, uses UUID dashboard routes, and serves `/join` plus `/s`.
8. Complete smoke tests before lifting the write freeze.

Do not run new code against schema 0020. Do not lift maintenance after applying
0021 while an old event writer is still running.

## Read-only preflight

Run without printing event IDs, codes, tokens, or record payloads.

```sql
SELECT current_setting('server_version_num')::integer >= 150000 AS supported;

SELECT to_regclass('public.events') IS NOT NULL
   AND to_regclass('public.event_access_links') IS NOT NULL
   AND to_regclass('public.song_requests') IS NOT NULL AS foundation_present;

SELECT count(*) FILTER (WHERE session_code IS NULL OR session_code !~ '^[0-9]{8}$') AS invalid_codes,
       count(*) - count(DISTINCT session_code) AS duplicate_codes
FROM public.events;

SELECT to_regclass('public.event_sessions') IS NULL
   AND to_regclass('public.event_session_codes') IS NULL AS new_tables_absent;
```

Stop if PostgreSQL is older than 15, the 0020 foundation is absent, codes are
invalid or duplicated, new objects already exist, the journal does not end at
0020, 0021 is not the only pending migration, or the write freeze is incomplete.

The migration sets `lock_timeout = 5s` and `statement_timeout = 120s`, runs its
contract preflight before the first DDL statement, then locks `events` for the
identity backfill and takes read-stability locks on historical access links and
requests. A timeout is a stop condition; do not bypass it with manual DDL.

## Backfill and preserved data

For every existing event, the migration:

- generates a UUID public ID;
- generates a token from exactly 16 bytes using `pgcrypto.gen_random_bytes`;
- creates exactly one `event_sessions` row;
- copies the unchanged `events.session_code` into its first historical code
  assignment;
- preserves the event creation timestamp for session and assignment creation;
- backfills a constrained close reason without changing lifecycle timestamps.

It does not delete, truncate, or rewrite event access links, song requests,
queue status, event IDs, codes, songs, audit data, or organization data.

Current code assignments have `revoked_at`, `valid_until`, `release_after`, and
`revoked_by_operator_id` set to `NULL`. A revoked assignment has
`valid_until = revoked_at`, cannot predate `valid_from`, and remains
quarantined until at least 365 days after `revoked_at`. The revoking operator is
historical context only and may become `NULL` through the existing
`ON DELETE SET NULL` foreign key without invalidating the revocation.

## Post-migration verification

```sql
SELECT (SELECT count(*) FROM public.events) =
       (SELECT count(*) FROM public.event_sessions) AS one_session_per_event;

SELECT count(*) AS violations
FROM public.events e
JOIN public.event_sessions s ON s.event_id = e.id
JOIN public.event_session_codes c
  ON c.session_id = s.id
 AND c.valid_until IS NULL
 AND c.revoked_at IS NULL
WHERE e.public_id IS NULL
   OR s.public_token !~ '^[A-Za-z0-9_-]{22}$'
   OR c.code <> e.session_code;

SELECT relname, indisvalid, indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE relname IN (
  'events_public_id_idx',
  'event_sessions_event_id_idx',
  'event_sessions_public_token_idx',
  'event_session_codes_code_idx',
  'event_session_codes_current_session_idx',
  'event_session_codes_session_created_at_idx',
  'event_session_codes_release_after_idx'
)
ORDER BY relname;
```

Expected results: one session and one current assignment per event, zero
violations, globally unique 22-character tokens and eight-digit codes, and all
seven indexes valid and ready. Verify RLS is enabled on both new tables and that
`PUBLIC`, `anon`, and `authenticated` have no table or identity-sequence
privileges and that `anon` and `authenticated` have no policies. Migration 0021
revokes these privileges explicitly, including when adverse default privileges
were configured before table creation.

Also compare pre/post aggregate counts and fingerprints for events,
`event_access_links`, requests, queue states, songs, organizations, and audit
rows. Only the declared identity columns/tables and close-reason backfill may
differ.

## Compatibility and dual-write

After 0021, every production event creation transaction writes the event,
session, immutable token, initial code assignment, and `events.session_code`.
Rotation updates code history and the legacy column atomically. Token-based APIs
are canonical; code APIs are compatibility adapters over the same service.

The queue broadcast trigger keeps the dashboard topic and changes the public
topic to `public:session:{publicToken}:queue`. Do not log the topic value.

## Smoke test

- create a draft event and verify a UUID dashboard URL;
- open `/join`, resolve its code, and confirm a 307 no-store redirect to `/s`;
- confirm QR targets the unchanged `/s` URL;
- rotate the code and prove the old code is neutral while the new code resolves;
- extend an active event;
- close and reopen within the strict 20-minute window with a new future close
  time and verify queue/request preservation;
- confirm `/session` and `/session/{code}` compatibility;
- inspect only safe aggregates and browser errors.

## Rollback and forward-fix

Before migration, rollback means aborting the release and restoring the verified
backup if necessary. Migration statements run in one transaction, so any error
must roll back the entire migration.

After 0021 has committed or new code has created identity rows, do not manually
drop columns/tables or restore schema 0020 in place. Keep maintenance enabled,
restore the full pre-migration backup only if no accepted post-migration writes
must survive, or ship a reviewed forward-fix migration and code correction.

## Future code-reuse contract

A future review may activate code reuse only after `release_after`, at least
365 days after final revocation. It
must reconcile the legacy unique column/index, preserve immutable public tokens
and history, prove no active/historical collision, and provide its own backup,
restore, rollout, and rollback plan.

## Observability

Monitor safe counts of creation, collision retry, rotation, resolver outcome,
extend, reopen, and migration verification. Never record short codes, public
tokens, session URLs, raw errors, cookies, connection strings, or auth payloads
in audit, diagnostics, or business logs.
