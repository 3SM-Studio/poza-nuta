# Migration 0020: Canonical session access

## Purpose

Migration 0020 gives every event exactly one canonical eight-digit session
code in `public.events.session_code`. It backfills existing events and retires
all active rows in the historical `public.event_access_links` table. The
application resolves participant access only through `/session/{code}` after
this migration.

Migration 0020 has not been applied to DEVELOPMENT or production as part of
this ticket.

## Deployment order

1. Obtain a separate approval and a tested PostgreSQL backup/restore point.
2. Stop old application instances and all writers that can create events or
   event access links.
3. Run the read-only preflight below.
4. Apply migration 0020.
5. Run the read-only verification below.
6. Deploy the code that writes and reads `events.session_code`.
7. Run the smoke checks and only then remove the maintenance window.

The migration must be applied before code that reads `session_code`. Old code
must not be re-enabled after 0020 because it can create legacy access-link rows
that the canonical resolver intentionally ignores.

## Preconditions

- The migration history ends at 0019 and 0020 is the only pending migration.
- PostgreSQL is version 15 or newer.
- `public.events` and `public.event_access_links` exist.
- `public.events.session_code`, `events_session_code_idx`, and
  `events_session_code_format_check` do not yet exist.
- No event or access-link writer is active.
- A full backup including `public`, `private`, and `drizzle` has passed a full
  restore test.

Read-only preflight:

```sql
SELECT current_setting('server_version_num')::integer >= 150000 AS supported;

SELECT
  to_regclass('public.events') IS NOT NULL AS events_present,
  to_regclass('public.event_access_links') IS NOT NULL AS legacy_links_present;

SELECT count(*) AS existing_session_code_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'events'
  AND column_name = 'session_code';

SELECT
  count(*) AS events,
  count(*) FILTER (WHERE status = 'active') AS stored_active_events,
  count(*) FILTER (WHERE closed_at IS NOT NULL) AS manually_closed_events
FROM public.events;

SELECT
  count(*) AS legacy_links,
  count(*) FILTER (WHERE active AND revoked_at IS NULL) AS active_legacy_links
FROM public.event_access_links;
```

Stop if any prerequisite differs from the expected 0019 schema or if a writer
cannot be frozen.

## Migration behavior

- Adds nullable `events.session_code` while both event tables are locked.
- Assigns every existing event a code derived from PostgreSQL
  `gen_random_uuid()` with at most 64 attempts per event.
- Deactivates and revokes legacy access-link rows without deleting history.
- Adds `NOT NULL`, an eight-digit format check, a cryptographic default, and a
  unique index.
- Verifies one valid distinct code per event and zero active legacy links before
  the transaction can commit.

The database stores the code, not a URL. Runtime event creation uses a CSPRNG
and bounded retry around the unique constraint; event and code are committed in
one transaction.

## Read-only verification

```sql
SELECT
  count(*) AS events,
  count(session_code) AS events_with_code,
  count(DISTINCT session_code) AS distinct_codes,
  count(*) FILTER (WHERE session_code !~ '^[0-9]{8}$') AS invalid_codes
FROM public.events;

SELECT
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'events'
  AND column_name = 'session_code';

SELECT
  i.indisunique,
  i.indisvalid,
  i.indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'events_session_code_idx';

SELECT pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'events_session_code_format_check'
  AND conrelid = 'public.events'::regclass;

SELECT count(*) AS active_legacy_links
FROM public.event_access_links
WHERE active = true OR revoked_at IS NULL;

SELECT relrowsecurity
FROM pg_class
WHERE oid = 'public.event_access_links'::regclass;
```

Expected results: all three event counts are equal, `invalid_codes = 0`, the
column is non-null with a default, the unique index is valid and ready, the
format constraint is present, active legacy links equal zero, and RLS remains
enabled.

## Smoke after code deployment

- Create an event and verify that its code is eight digits and survives reload.
- Verify `/session`, a valid `/session/{code}`, and a neutral invalid-code view.
- Verify scheduled, active, manually closed, and expired event states.
- Confirm the event list and detail show the same effective status.
- Confirm queue writes are rejected after the effective close time.
- Copy the code and link, render/download QR, and verify QR targets only the
  canonical `/session/{code}` path.
- Confirm old manual generation endpoints and controls are unavailable.

## Rollback and forward-fix

Before deploying the new code, rollback requires restoring the approved backup.
The migration revokes legacy links, so dropping the new column alone is not a
complete rollback.

After the new code has created events or canonical codes have been distributed,
do not drop the column or reactivate legacy links. Use a reviewed forward-fix
that preserves assigned codes and queue history. Production execution always
requires a separate approval, maintenance window, backup, and tested restore
point.
