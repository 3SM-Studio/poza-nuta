# Migration 0017: Import Job Data Foundation Expand

## Purpose

Migration `0017_import_job_data_foundation_expand` adds the transitional data
foundation for durable iSing and KaraFun import jobs. It backfills existing
jobs, replaces the expanded legacy status enum with the accepted five-state
enum, adds safe diagnostics and enforces one active job per source.

This is the expand phase only. It intentionally keeps selected new fields
nullable so the Ticket 11A writer does not fail during the controlled deployment
window. Migration 0018 will add the final lifecycle, initiator, safe-error and
terminal-state constraints only after the new writer has been deployed and
observed.

Migration 0017 has not been run on Supabase or any existing database as part of
this ticket.

## Deployment Preconditions

- Disable all manual iSing and KaraFun imports before taking the restore point.
- Confirm migration 0016 is approved, applied and verified first.
- Take a database backup or restore point and obtain separate approval for the
  database migration.
- Confirm every terminal job (`done`, `failed`, `succeeded`, `cancelled`) has
  `finished_at`.
- Confirm no source has more than one job in `pending`, `queued` or `running`.
- Keep imports disabled until migration verification, compatible writer deploy
  and smoke testing are complete.

The migration locks `import_jobs` against concurrent writes while its preflight,
backfill and enum replacement execute. It aborts rather than repairing missing
terminal timestamps or competing active jobs.

## Backfill

Status mapping is exact:

| Before 0017 | After 0017 |
| --- | --- |
| `pending` | `queued` |
| `running` | `running` |
| `done` | `succeeded` |
| `failed` | `failed` |
| `succeeded` | `succeeded` |
| `cancelled` | `cancelled` |

All historical jobs receive `mode = write`. Jobs with
`started_by_operator_id` receive `initiator_kind = operator`; the rest receive
`initiator_kind = legacy`.

Historical `running` and terminal jobs receive `started_at = created_at`.
Existing `finished_at` is retained physically and represents `terminalAt` in
the Drizzle model. `updated_at` is initialized from `finished_at` when present,
otherwise from `created_at`.

Existing `total_rows`, `imported_count` and `skipped_count` values are retained.
Historical `processed_count` is the sum of the two outcomes that can be proven
from the old schema: `imported_count + skipped_count`. Non-failed historical
jobs receive `error_count = 0`. Failed historical jobs receive
`error_count = NULL` because the old schema cannot distinguish a job-level
failure from a count of rejected rows. Migration 0018 must not replace this
unknown value with invented precision.

Historical failed jobs receive:

- `safe_error_code = LEGACY_IMPORT_FAILURE`;
- `safe_error_summary = A legacy import failed. Historical error details were not retained.`

No previous `error` text is copied. After the safe backfill is verified, all
historical raw `error` values are cleared. This step requires the restore point
because the removed text may have contained sensitive information and is not
recoverable from application data afterward.

## Transitional Model

The physical `total_rows` and `finished_at` columns remain in place. Application
code exposes them as `totalCount` and `terminalAt`.

`mode`, `initiator_kind` and `updated_at` are backfilled and required. Fields
that the Ticket 11A writer did not know about remain nullable in this phase,
including `started_at`, `processed_count`, `error_count` and safe error fields.
This makes omissions visible without silently inventing values.

Expand-only constraints enforce:

- non-negative new counters when present;
- counter equality when both `processed_count` and `error_count` are known;
- `processed_count <= total_rows` when `total_rows` is nonzero;
- complete, bounded safe-error pairs when present;
- complete artifact timestamps and non-reversed deletion time when an artifact
  is present;
- a cancellation actor only when a cancellation timestamp exists.

The value `total_rows = 0` retains its legacy meaning of unknown/not yet
measured during a running job. Migration 0018 may replace this transitional
representation after the worker contract is fixed.

## Retention Anchor Indexes

Migration 0017 adds two partial indexes for future retention cleanup queries:

- `import_jobs_terminal_at_idx` covers terminal jobs with a non-null
  `finished_at`, which is the 365-day metadata retention anchor exposed as
  `terminalAt` by the application;
- `import_jobs_artifact_uploaded_at_idx` covers source artifacts that have not
  been deleted, using `artifact_uploaded_at` as the maximum seven-day retention
  anchor for the KaraFun source file.

These indexes support a future cleanup runner. They do not schedule, execute or
audit cleanup, and they do not change the accepted retention periods.

## Diagnostics

`import_job_diagnostics` stores only:

- an identity ID;
- the import job ID;
- a bounded stable code;
- a bounded safe summary;
- `recorded_at`, the 30-day retention anchor.

The table has RLS enabled and no browser policy. It contains no raw error,
source row, storage path, URL, credentials or provider payload. Deleting an
import job cascades to its diagnostics. No cleanup runner is included here.

## Read-Only Verification

Verify the final enum:

```sql
SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
WHERE pg_namespace.nspname = 'public'
  AND pg_type.typname = 'import_job_status'
ORDER BY enumsortorder;
```

Expected: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

Verify backfill completeness and raw-error removal:

```sql
SELECT count(*) AS incomplete_jobs
FROM public.import_jobs
WHERE mode IS NULL
   OR initiator_kind IS NULL
   OR updated_at IS NULL
   OR error IS NOT NULL
   OR (status = 'failed' AND (safe_error_code IS NULL OR safe_error_summary IS NULL));
```

Expected: `0`.

Verify active-source uniqueness:

```sql
SELECT source, count(*)
FROM public.import_jobs
WHERE status IN ('queued', 'running')
GROUP BY source
HAVING count(*) > 1;
```

Expected: no rows. Also inspect `pg_indexes` for
`import_jobs_one_active_per_source_idx` and confirm its predicate is exactly
`status IN ('queued', 'running')`.

Inspect `pg_indexes` for `import_jobs_terminal_at_idx` and
`import_jobs_artifact_uploaded_at_idx`. Confirm that the first covers non-null
`finished_at` for terminal statuses and the second covers non-deleted artifacts
by `artifact_uploaded_at`. Their presence is not evidence that cleanup runs.

Verify diagnostics columns, checks, RLS, indexes and the cascading FK through
`information_schema`, `pg_constraint`, `pg_indexes` and `pg_class`. Do not
insert diagnostic or import data as part of read-only verification.

## Deployment Order

1. Disable manual imports.
2. Take the approved backup or restore point.
3. Apply and verify the separately approved migration 0016.
4. Apply migration 0017.
5. Run the read-only verification above.
6. Deploy the Ticket 11B-expand writer.
7. Run a controlled development smoke for one iSing write job and inspect only
   safe job metadata.
8. Re-enable imports.

The writer from commit `ea5b007` is tolerated only while imports remain
disabled in the controlled migration window. Do not roll application code back
to a version older than Ticket 11A after 0017.

## Rollback And Forward Fix

Before migration 0017 commits, PostgreSQL transaction rollback restores the
previous enum and raw rows. After commit, do not attempt a destructive enum or
column rollback. Restore the approved database restore point only if the new
writer has not run and operational approval explicitly selects full restore.

After the new writer has created or updated jobs, use a forward fix. Keep
imports disabled while correcting schema or writer defects. Do not drop the new
diagnostics table or fields and do not repopulate raw `error` text.

Migration 0018 is a separate contract phase. It must not run until the new
writer has been deployed, smoked and observed, and a preflight confirms that no
transitional incomplete records were created.
