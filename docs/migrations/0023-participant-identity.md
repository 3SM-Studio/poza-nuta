# Migration 0023 — participant identity foundation

## Scope

Migration `0023_foamy_gargoyle.sql` is an additive foundation for anonymous
participant identity. It creates `participant_identities`,
`participant_credentials`, and `event_participants`, then adds nullable
`song_requests.event_participant_id` with `ON DELETE SET NULL`.

It performs no backfill and does not modify existing song requests. Existing
and operator-created requests therefore remain valid without a participant.
All three new tables have RLS enabled and receive no browser role policies or
grants; application access remains server-side through Drizzle.

## Release order

1. Create an approved backup or restore point.
2. Apply migration 0023 before deploying code that writes participant rows.
3. Run the read-only verification below.
4. Deploy the compatible application writer and participant join gate.
5. Smoke join, reload recognition, and one public request without logging the
   raw credential or cookie.

Do not apply this migration to a shared or production database without the
normal migration approval.

## Read-only verification

```sql
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'participant_identities',
    'participant_credentials',
    'event_participants'
  )
ORDER BY c.relname;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'participant_credentials_token_hash_idx',
    'event_participants_session_participant_idx',
    'event_participants_session_nickname_idx',
    'song_requests_event_participant_idx'
  )
ORDER BY indexname;

SELECT is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'song_requests'
  AND column_name = 'event_participant_id';

SELECT count(*) AS unexpected_owned_legacy_requests
FROM song_requests
WHERE event_participant_id IS NOT NULL;
```

Expected: three RLS-enabled tables, four listed indexes, a nullable ownership
column, and zero owned legacy requests immediately after migration.

## Rollback and forward-fix

Before the participant writer is deployed, a rollback requires restoring the
approved pre-migration backup; do not use ad-hoc destructive SQL on a shared
database.

After participant rows or owned requests exist, prefer a reviewed forward-fix.
Dropping the tables or ownership column would discard identity and ownership
history. A safe application rollback may leave the additive schema in place:
the column is nullable and existing code ignores it. Any later constraint or
model correction must preserve raw-token secrecy, existing memberships, and
request ownership.
