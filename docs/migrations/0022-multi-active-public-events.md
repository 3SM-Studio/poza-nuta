# Migration 0022: multiple active public events

## Purpose

Migration `0022_multi_active_public_events` removes the legacy partial unique
index that limited an organization to one active public event. Event access is
already scoped by organization public ID, event public UUID, session, token,
and code. The migration keeps `is_active_public_event` and every other legacy
column unchanged.

## Deployment order

1. Verify the deployed code uses event-scoped lifecycle and queue services.
2. Create and fully restore a fresh backup of `public`, `private`, and
   `drizzle` on the same PostgreSQL major version.
3. Stop event lifecycle and queue writers for the migration window.
4. Run the read-only preflight below.
5. Apply migration 0022 exactly once.
6. Run the post-migration verification.
7. Deploy the code that no longer maps the removed index to a domain conflict.
8. Smoke two active events in one organization before lifting the write freeze.

Do not deploy multi-active code against schema 0021. A timeout, unexpected
index definition, pending migration other than 0022, or active writer is a stop
condition.

## Read-only preflight

```sql
SELECT current_setting('server_version_num')::integer >= 150000 AS supported;

SELECT index_class.relname,
       i.indisunique,
       i.indisvalid,
       i.indisready,
       access_method.amname,
       indexed_column.attname,
       pg_get_expr(i.indpred, i.indrelid) AS predicate
FROM pg_index AS i
JOIN pg_class AS index_class ON index_class.oid = i.indexrelid
JOIN pg_namespace AS index_namespace
  ON index_namespace.oid = index_class.relnamespace
JOIN pg_class AS table_class ON table_class.oid = i.indrelid
JOIN pg_namespace AS table_namespace
  ON table_namespace.oid = table_class.relnamespace
JOIN pg_am AS access_method ON access_method.oid = index_class.relam
JOIN pg_attribute AS indexed_column
  ON indexed_column.attrelid = table_class.oid
 AND indexed_column.attnum = i.indkey[0]
WHERE index_namespace.nspname = 'public'
  AND index_class.relname = 'events_one_active_public_per_workspace_idx'
  AND table_namespace.nspname = 'public'
  AND table_class.relname = 'events';
```

Expect exactly one valid and ready unique btree index on `workspace_id` with
predicate `(is_active_public_event = true)`. Also verify migration history ends
at 0021 and 0022 is the only pending migration. The migration repeats this
contract check after taking an `ACCESS EXCLUSIVE` lock and fails with SQLSTATE
`23514` and constraint
`events_one_active_public_per_workspace_idx_contract` before `DROP INDEX` when
the expected state is absent or changed.

## Migration effect

The migration drops exactly
`public.events_one_active_public_per_workspace_idx`. It performs no DML and
does not alter tables, columns, constraints, foreign keys, enums, RLS, ACL, or
any other index. It does not change sessions, tokens, codes, QR targets,
quarantine, or code recycling.

## Post-migration verification

```sql
SELECT to_regclass('public.events_one_active_public_per_workspace_idx') IS NULL
  AS legacy_index_removed;

SELECT count(*) AS active_events,
       count(DISTINCT workspace_id) AS organizations_with_active_events
FROM public.events
WHERE is_active_public_event;

SELECT relname, indisvalid, indisready
FROM pg_index AS i
JOIN pg_class AS c ON c.oid = i.indexrelid
WHERE i.indrelid = 'public.events'::regclass
ORDER BY relname;
```

Compare pre/post table counts and stable fingerprints for events, sessions,
codes, requests, queue state, organizations, songs, and audit rows. They must
be identical. Verify all remaining indexes, constraints, foreign keys, RLS,
policies, and grants against the 0021 baseline.

## Smoke

- create two active public events for one organization;
- confirm each event has its own public UUID, session, token, code, and queue;
- submit one request to each session and verify organizer actions remain scoped
  to the event in the route;
- close both events and reopen them concurrently;
- verify cross-organization event UUID access remains denied.

Do not expose event IDs, session tokens, codes, or request payloads in logs.

## Rollback and forward-fix

Before any multi-active write, rollback may recreate the original unique
partial index after verifying there is at most one active public event per
organization. Once multiple active events exist, recreating that index is not
safe. Keep writes frozen and either restore the verified pre-0022 backup when
no accepted writes must survive, or ship a reviewed forward-fix. Do not close
events or delete data merely to force rollback.
