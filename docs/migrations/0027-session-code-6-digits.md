# Migration 0027: strict six-digit session codes with legacy remediation

## Contract and capacity

Runtime session codes are fixed-width ASCII strings from `000000` through
`999999`. Leading zeros are significant. The database predicate is:

```sql
length(code) = 6
and octet_length(translate(code, '0123456789', '')) = 0
```

Stage 1 never reuses an issued code. The history table keeps a globally unique
runtime `code`, including codes assigned by this migration to legacy rows. Its
`release_after` value is retention metadata only; it never releases a code for
reuse. The lifetime
capacity is therefore 1,000,000 issued codes.

Legacy eight-digit values are audit metadata only after 0027. They are stored
in nullable `public.event_session_codes.legacy_code`, protected by a partial
unique index and the following collation-independent check:

```sql
legacy_code is null
or (
  length(legacy_code) = 8
  and octet_length(translate(legacy_code, '0123456789', '')) = 0
)
```

New rows leave `legacy_code` null. It is not a lookup key, is not exposed by
public DTOs, and must never be used as a compatibility fallback. Old
eight-digit bookmarks and URLs stop working after the strict-six deployment;
there is deliberately no redirect or legacy resolver.

## Fail-closed preflight

Before taking the strong table locks required by the schema transition, 0027
runs a read-only preflight and aborts unless all of these invariants hold:

1. The schema still has the validated eight-digit checks, eight-digit default,
   expected global unique indexes, unique event/session pairing, and no
   `legacy_code` column.
2. Every existing runtime value in `events.session_code` and
   `event_session_codes.code` is exactly eight ASCII digits.
3. No event is effectively active or scheduled. The SQL mirrors the application
   lifecycle: `closed`, `cancelled`, or non-null `closed_at` are terminal;
   future `starts_at` is scheduled; otherwise an event is active while
   `coalesce(auto_close_at, ends_at)` remains in the future.
4. Every event has exactly one event session and exactly one unrevoked/current
   history row, and the event and history codes match.
5. No orphan or mismatched current history row exists.
6. Legacy event and history values are unique under the pre-0027 invariants.
7. The number of distinct history values is at most 1,000,000.

The critical-section lock order is `events` → `event_sessions` →
`event_session_codes`: the first `ALTER TABLE events` takes `ACCESS EXCLUSIVE`,
then 0027 explicitly takes `SHARE` on `event_sessions`, then the history DDL
takes `ACCESS EXCLUSIVE`. `SHARE` is the narrowest table lock that conflicts
with the `ROW EXCLUSIVE` lock of ordinary `INSERT`, `UPDATE`, and `DELETE` on
`event_sessions`. This drains in-flight session writes before the locked
recheck, keeps subsequent writes out through commit, and closes the
session-delete/history-cascade race. The subsequent recheck statement sees
committed changes after any lock wait under PostgreSQL `READ COMMITTED`.
A race or invariant violation rolls back the complete transaction.

## Deterministic mapping and atomic remediation

The migration creates a transaction-local mapping from every unique history
code to a strict-six value. Legacy values are sorted lexicographically under
the explicit `C` collation and assigned `row_number() - 1`, padded to six
characters. Therefore N unique
legacy values deterministically receive `000000` through `N-1`, with no use of
`random()`, no secret, and no million-row namespace enumeration.

The preflight caps N at 1,000,000. Primary/unique constraints on the temporary
mapping fail closed on any collision. The transformation then:

1. copies each original history value to `legacy_code`;
2. replaces every history `code` with its mapped strict-six value;
3. replaces `events.session_code` through the same legacy-keyed mapping;
4. changes the database default to six digits;
5. creates the partial unique audit index;
6. adds the two runtime checks and audit check as `NOT VALID`;
7. verifies data, pairing, uniqueness, indexes, defaults, and constraint
   metadata before commit.

The current event and its current history row use the same mapping entry.
Revoked history receives its own unique strict-six value and retains its
revocation timestamps, `release_after`, and rotation reason. Since the entire
Drizzle migration runs in one transaction, any failure restores the complete
pre-0027 schema and data.

This deterministic mapping is archival remediation for closed/cancelled
events. It does not replace the application generator. Runtime generation
remains `crypto.randomInt(0, 1_000_000)` plus `padStart(6, "0")`, with bounded
retry on both event and history uniqueness conflicts.

## Required release flow

The production runtime before cutover still creates eight-digit codes. A full
write freeze is mandatory for event creation, session-code rotation, direct
writers using the database default, and direct writes or deletes involving
`events`, `event_sessions`, or `event_session_codes`. Verify that every such
writer is stopped before proceeding; this project has no release-operator
write bypass to assume during maintenance.

Future authorized release order:

1. Prepare WAF rules in observe/log mode without enforcement.
2. Enable the write freeze.
3. Repeat the read-only checks: no active events, no scheduled/upcoming events,
   expected eight-digit legacy shape, exact event/current-history pairing, and
   capacity within 1,000,000.
4. Apply revised 0027 atomically.
5. Verify all runtime codes are strict-six, all legacy values are preserved,
   pairing remains exact, and both runtime/audit identities are unique.
6. Deploy the strict-six application immediately while the freeze remains.
7. Run non-mutating production smoke for the reachable `/join`, resolver, and
   `/s/<token>` states. With no active or scheduled event, a successful live
   join transition cannot be claimed at this point.
8. Validate the three `NOT VALID` constraints in a separate transaction during
   normal database load.
9. Repeat non-mutating production smoke and verify the validated constraints.
10. Remove the write freeze.
11. Immediately run controlled write smoke with the strict-six runtime: create
    an event, rotate its code, and verify the `/join` → resolver → `/s/<token>`
    transition. If this fails, re-enter the write freeze and use forward-fix
    recovery; the 0027 commit has already crossed the no-simple-rollback point.
12. Monitor constraint errors, uniqueness retries, join resolution, and route
    error rates.
13. Enable WAF enforcement only after observe data supports separate thresholds
    for the traffic groups below.

Do not apply 0027 if any recheck differs from the accepted preflight shape.

## Separate validation

`NOT VALID` checks protect every new or changed row immediately but avoid doing
the full historical validation while the main DDL transition holds its locks.
After strict-six deployment and the first non-mutating smoke, validate in a separate
transaction before lifting the write freeze:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.event_session_codes
  VALIDATE CONSTRAINT event_session_codes_code_format_check;
ALTER TABLE public.event_session_codes
  VALIDATE CONSTRAINT event_session_codes_legacy_code_format_check;
ALTER TABLE public.events
  VALIDATE CONSTRAINT events_session_code_format_check;
COMMIT;
```

Verify exact constraint state:

```sql
SELECT table_schema.nspname AS table_schema,
       table_relation.relname AS table_name,
       constraint_metadata.conname AS constraint_name,
       constraint_metadata.convalidated AS validated,
       pg_get_constraintdef(constraint_metadata.oid) AS definition
FROM pg_constraint AS constraint_metadata
JOIN pg_class AS table_relation
  ON table_relation.oid = constraint_metadata.conrelid
JOIN pg_namespace AS table_schema
  ON table_schema.oid = table_relation.relnamespace
WHERE (table_schema.nspname, table_relation.relname, constraint_metadata.conname) IN (
  ('public', 'events', 'events_session_code_format_check'),
  ('public', 'event_session_codes', 'event_session_codes_code_format_check'),
  ('public', 'event_session_codes', 'event_session_codes_legacy_code_format_check')
)
ORDER BY table_relation.relname, constraint_metadata.conname;
```

Verify the global runtime identity and audit identity indexes:

```sql
SELECT index_schema.nspname AS index_schema,
       index_relation.relname AS index_name,
       index_metadata.indisunique,
       index_metadata.indisvalid,
       index_metadata.indisready,
       pg_get_expr(index_metadata.indpred, index_metadata.indrelid) AS predicate
FROM pg_index AS index_metadata
JOIN pg_class AS index_relation
  ON index_relation.oid = index_metadata.indexrelid
JOIN pg_namespace AS index_schema
  ON index_schema.oid = index_relation.relnamespace
WHERE index_metadata.indrelid = 'public.event_session_codes'::regclass
  AND index_relation.relname IN (
    'event_session_codes_code_idx',
    'event_session_codes_legacy_code_idx'
  )
ORDER BY index_relation.relname;
```

## WAF traffic groups

Use strict-six, method-aware matchers only:

```text
Entry resolution (GET): ^/(?:join|session)/[0-9]{6}/?$
Event lookup (GET): ^/api/session/[0-9]{6}/event/?$
Queue reads (GET): ^/api/session/[0-9]{6}/queue/?$
Search reads (GET): ^/api/session/[0-9]{6}/songs/search/?$
```

Queue and search reads have different normal frequencies from direct entry and
event bootstrap, so each group needs observe data and a separate threshold.
`POST /api/session/<code>/requests` always returns `410` without code
resolution and is not an enumeration-resolution route.

## Rollback boundary

Before the remediation transaction commits, a failed migration rolls back to
the unchanged eight-digit schema and the old application remains usable.

**POINT OF NO SIMPLE ROLLBACK:** commit of revised 0027, which first stores
production strict-six codes.

After that commit, redeploying the old SHA is unsafe: the old runtime accepts
and generates eight-digit values while production data and checks are
strict-six. Recovery is forward-fix only under the write freeze. It must retain
all runtime and legacy audit history; it must not delete rows, weaken global
uniqueness, or reclaim issued codes.
