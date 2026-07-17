# Migration 0019: Import Job Worker Foundation

## Purpose

Migration `0019_import_job_worker_foundation` adds the durable claim, lease and
attempt state required by Ticket 13A. It also makes audit actors explicit,
protects terminal import jobs from updates and creates a least-privilege
`import_worker` NOLOGIN group role.

This migration does not run an importer, create a worker loop, provision a
LOGIN, schedule work or expose API/UI. It has not been applied to DEVELOPMENT,
Supabase or production as part of Ticket 13A.

## Preconditions

- Migration history ends exactly at 0018 and contains no 0019 entry.
- A full maintenance/write freeze covers every process that can write
  `operator_audit_log`, not only importers.
- All old application instances are stopped and drained. Login/logout, event
  mutations, session mutations, platform mutations, auto-close, iSing and
  KaraFun writes remain unavailable for the entire migration and deployment
  window.
- No import writer or audit writer is active, and no queued/running import job
  exists.
- `public.import_jobs` contains no `queued` or `running` row.
- The complete 0018 schema, enum, constraint, index, FK and RLS contract is
  present.
- No 0019 column, enum, role, index, function or trigger already exists.
- A current backup or restore point has been fully restored in an isolated
  PostgreSQL environment.
- Applying the migration to any shared environment requires separate owner
  approval.

The migration locks `public.import_jobs` and `public.operator_audit_log` in
`SHARE ROW EXCLUSIVE` mode before the catalog and active-job preflight. A
preflight mismatch raises SQLSTATE `23514` with a stable constraint identifier
and aborts before the first schema change.

## Read-Only Preflight

Confirm there are no active jobs:

```sql
SELECT count(*) AS active_import_jobs
FROM public.import_jobs
WHERE status IN ('queued', 'running');
```

Expected: `0`.

Inspect active client sessions conservatively before taking the migration
locks. The deployment operator must classify every returned application and
automation session and prove that none can write `operator_audit_log` or
`import_jobs`:

```sql
SELECT application_name, state, count(*) AS sessions
FROM pg_catalog.pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND backend_type = 'client backend'
GROUP BY application_name, state
ORDER BY application_name, state;
```

Also verify that no active statement currently references either write target:

```sql
SELECT count(*) AS active_import_or_audit_statements
FROM pg_catalog.pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state <> 'idle'
  AND (
    query ~* '\\moperator_audit_log\\M'
    OR query ~* '\\mimport_jobs\\M'
  );
```

Expected: `0`. An unexplained session, a writer that cannot be drained, or any
inability to prove the full write freeze is a stop condition. Database queries
supplement but do not replace operational confirmation that old application
instances and automation have been stopped.

Verify that migration 0018 is the final history entry, that its five status
values, three modes, three initiator kinds, 22 columns, eight validated checks,
six valid and ready indexes, two FK actions and RLS state match the committed
0019 preflight. Verify separately that the following are absent:

- `public.audit_actor_kind`;
- `operator_audit_log.actor_kind`;
- the four worker columns and three worker indexes;
- `private.protect_terminal_import_job()`;
- database role `import_worker`.

Do not bypass a mismatch or create missing objects manually.

## Schema And Data Changes

The migration adds:

- `attempt_count integer NOT NULL DEFAULT 0`, constrained to `0..3`;
- nullable `claim_token uuid`, `lease_expires_at timestamptz` and
  `heartbeat_at timestamptz`;
- state checks for queued, running and terminal claims;
- heartbeat and lease ordering checks;
- queued-claim, expired-recovery and partial unique claim-token indexes;
- `audit_actor_kind` with `operator`, `system`, `legacy`;
- `operator_audit_log.actor_kind NOT NULL` without a default;
- a terminal-update protection trigger;
- a NOLOGIN `import_worker` group role with narrow grants and RLS policies.

Historical terminal jobs receive `attempt_count = 0`. Existing audit rows with
an operator become `operator`; rows without one become `legacy`. The migration
does not synthesize an operator and does not change import counters, statuses,
timestamps, safe errors or artifact metadata.

Terminal rows reject ordinary `UPDATE` operations with SQLSTATE `23514` and
constraint `import_jobs_terminal_immutable`. The only exception is the existing
FK `ON DELETE SET NULL` transition of
`cancellation_requested_by_operator_id` from non-NULL to NULL when every other
column is unchanged. This exception cannot change cancellation time, status,
timestamps, counters, claim data, errors or artifact state. `DELETE` remains
available to a future retention service with separately approved privileges;
`import_worker` receives no `DELETE` or `TRUNCATE` grant.

## Worker Role Provisioning

Migration 0019 creates only `import_worker NOLOGIN`. A deployment operator must
provision a separate server-only LOGIN and membership outside this migration,
after a dedicated secret and grant review. Never add a password to a committed
migration.

The worker connection URL must identify that dedicated LOGIN, never a database
owner or superuser. The LOGIN must be `NOSUPERUSER NOCREATEDB NOCREATEROLE
NOINHERIT NOREPLICATION NOBYPASSRLS` and receive only membership in
`import_worker`. That must be its only direct role membership, and the grant
must not include `ADMIN OPTION`. The LOGIN must not own the current database,
the `public`, `private` or `drizzle` schemas, or any object in those schemas.
Every physical postgres.js session must apply
`options=-c role=import_worker` in its PostgreSQL startup parameters. A single
post-connect `SET ROLE` is insufficient because it does not survive reconnect.

Before recovery and again before claim, the worker must verify both identities
independently. The dedicated `session_user` must be a different LOGIN with
`NOINHERIT`, have exactly one direct membership in `import_worker` without
`ADMIN OPTION`, be able to set that role, have none of the administrative
attributes listed above and own neither the current database nor any schema or
object in `public`, `private` or `drizzle`. The effective `current_user` must be
exactly `import_worker`, and that role must remain `NOLOGIN`, `NOINHERIT`,
`NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE` and
`NOREPLICATION`. It must own neither the current database nor any schema or
object in those three application schemas and must not be a member of a parent
role. A failed identity check stops the process before recovery, claim,
diagnostics or audit writes. The same complete checks must pass after a forced
backend disconnect and automatic reconnect.

`import_worker` is a global PostgreSQL cluster role. A custom or schema-only
dump restricted to `public`, `private` and `drizzle` records grants and policies
that reference the role, but does not contain `CREATE ROLE`. A restore fixture
must therefore create the exactly verified group role before restoring
post-data:

```sql
CREATE ROLE import_worker
NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
NOINHERIT NOREPLICATION NOBYPASSRLS;
```

Do not restore a password, LOGIN attribute or worker secret from the repository
or backup fixture. After post-data, verify the policies and grants and confirm
that `rolcanlogin`, `rolinherit` and `rolbypassrls` are all false, together with
the remaining safe role attributes. A complete restore of a post-0019 backup,
including this role choreography, is mandatory before deployment approval.

The group role can read import job metadata and update only active import jobs,
insert safe diagnostics and system completion/failure audit rows, and
select/insert/update songs with the required sequences. The read policy must
also admit the terminal row produced by a legal update; the separate update
policy still requires an active source row. The role cannot perform DDL,
DELETE, TRUNCATE, bypass RLS, read platform membership/session tables or act as
`anon`/`authenticated`.

## Read-Only Verification

After migration, verify:

1. history ends exactly at 0019;
2. existing import jobs and audit rows are preserved;
3. active jobs remain zero;
4. all four worker columns, three checks and three indexes match the schema;
5. the claim-token index is unique and partial;
6. actor backfill and actor constraint are complete;
7. the terminal function is `SECURITY DEFINER` with an empty search path and
   only its expected trigger exists;
8. `import_worker` is NOLOGIN, non-superuser and without BYPASSRLS;
9. its grants and policies are exactly the committed least-privilege set;
10. `anon` and `authenticated` receive no new access;
11. queued/running/terminal constraint probes and terminal immutability behave
    as documented.

Do not insert business data during deployment verification.

## Deployment Order

Ticket 13A and Ticket 13B are one release unit. Migration 0019 must be applied
before starting any code that requires `actor_kind` or the worker contract, and
all code that writes `operator_audit_log` must be upgraded before maintenance is
removed. Never deploy the Ticket 13A commit separately against schema 0018.

1. Enter full maintenance and freeze every import and audit writer.
2. Stop and drain all old application instances and automation; confirm that
   login/logout, event, session and platform mutations and auto-close cannot run.
3. Take and restore-test the approved backup.
4. Run the complete read-only database and active-session preflight.
5. Apply migration 0019 by itself while maintenance remains active.
6. Run schema, data, privilege, RLS and trigger verification.
7. Provision the dedicated LOGIN outside the migration, without exposing its
   secret.
8. Deploy the complete 13A+13B release, including every actor-kind-compatible
   audit writer, while old instances remain stopped.
9. Verify the dedicated LOGIN and effective `import_worker` contracts,
   including exact membership without `ADMIN OPTION`, ownership, parent-role
   absence, `session_user`, `current_user`, safe attributes and a forced
   reconnect before allowing recovery or claim.
10. Smoke the worker and audit paths with controlled data.
11. Remove maintenance and re-enable imports only after the complete release and
   smoke are green.

Do not run or re-enable the legacy iSing CLI after step 5. Keep it disabled
after migration 0019: its direct `running` insert does not own a claim and
intentionally does not satisfy the 0019 worker contract.

Validate the complete iSing configuration before opening the worker loop. In
particular, `ISING_IMPORT_LIMIT` is forbidden in continuous polling mode so a
long-lived worker cannot inherit a partial-import limit. A positive limit is
allowed only for a controlled smoke started with `--once`; invalid or missing
iSing configuration must stop the process before recovery, claim, diagnostics
or audit writes.

## Rollback And Forward Fix

A preflight or migration failure rolls back transactionally. Investigate the
mismatch; do not weaken the preflight.

Before any 0019-aware writer creates or mutates a job, an approved full restore
may return to the pre-0019 restore point. Revoke and remove separately
provisioned LOGIN membership before that restore.

After any 0019-aware job, claim, diagnostic or system audit exists, use a
forward fix. Preserve job and audit identities, keep imports frozen and do not
drop claim or actor columns to force an old writer back into service.

## Verification Evidence

Repository tests must apply migrations 0000-0019 to isolated
`postgres:15-alpine` and `postgres:17-alpine` containers without persistent
volumes. They verify migration fail-fast behavior, data preservation, worker
constraints, actor backfill, terminal immutability, role/RLS boundaries,
transactional audit behavior and deterministic claim concurrency. Test
containers must be removed after the run.
