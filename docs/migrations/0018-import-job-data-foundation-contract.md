# Migration 0018: Import Job Data Foundation Contract

## Purpose

Migration `0018_import_job_data_foundation_contract` closes the expand window
opened by migration 0017. It validates existing import jobs before changing the
schema, makes the final job contract durable and removes the empty legacy raw
error column.

This migration is contract-only. It does not backfill data, claim work, run an
import, schedule cleanup or add API/UI behavior. It has not been applied to
DEVELOPMENT, Supabase or production as part of this ticket.

## Preconditions

- Migration history ends exactly at 0017 and contains no 0018 entry.
- The Ticket 11B-expand writer is deployed and all imports have been observed
  to write complete contract data.
- Manual and scheduled iSing and KaraFun imports are disabled for the migration
  window.
- No process can create or update `import_jobs` during the migration.
- A current backup or restore point has been created and fully restored in an
  isolated PostgreSQL 17 environment.
- The read-only gate below returns zero for every category.
- The two existing `import_jobs` foreign keys point to
  `public.operator_users(id)`, use `ON UPDATE NO ACTION` and have their 0017
  `ON DELETE SET NULL` actions.
- Applying the migration to any shared or production database requires
  separate owner approval.

The migration takes `SHARE ROW EXCLUSIVE` on `public.import_jobs`. Its complete
data and foreign-key preflight runs before the first schema change. Any
unexpected row or catalog shape aborts the transaction.

## Read-Only Contract Gate

First verify that the status enum has exactly the final values in order:

```sql
SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS status_values
FROM pg_catalog.pg_enum e
JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname = 'import_job_status';
```

The only accepted result is:

```text
{queued,running,succeeded,failed,cancelled}
```

An additional, missing or reordered value makes migration 0018 fail with
SQLSTATE `23514` and constraint `import_jobs_status_contract`, even when no row
uses the unexpected value.

Then run these counts without exposing job identifiers or payloads:

```sql
SELECT
  count(*) FILTER (
    WHERE status::text NOT IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ) AS invalid_status,
  count(*) FILTER (
    WHERE NOT (
      (status = 'queued' AND started_at IS NULL AND finished_at IS NULL)
      OR (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL)
      OR (status IN ('succeeded', 'failed') AND started_at IS NOT NULL AND finished_at IS NOT NULL)
      OR (status = 'cancelled' AND finished_at IS NOT NULL)
    )
  ) AS invalid_lifecycle,
  count(*) FILTER (
    WHERE (started_at IS NOT NULL AND started_at < created_at)
      OR (finished_at IS NOT NULL AND (
        finished_at < created_at
        OR (started_at IS NOT NULL AND finished_at < started_at)
      ))
      OR updated_at IS NULL
      OR updated_at < created_at
      OR (started_at IS NOT NULL AND updated_at < started_at)
      OR (finished_at IS NOT NULL AND updated_at < finished_at)
      OR (cancellation_requested_at IS NOT NULL AND cancellation_requested_at < created_at)
  ) AS invalid_timestamps,
  count(*) FILTER (
    WHERE mode IS NULL
      OR initiator_kind IS NULL
      OR NOT (
        (initiator_kind = 'operator' AND started_by_operator_id IS NOT NULL)
        OR (initiator_kind IN ('system', 'legacy') AND started_by_operator_id IS NULL)
      )
  ) AS invalid_initiator,
  count(*) FILTER (
    WHERE processed_count IS NULL
      OR processed_count < 0
      OR (error_count IS NOT NULL AND error_count < 0)
      OR (error_count IS NULL AND NOT (initiator_kind = 'legacy' AND status = 'failed'))
      OR processed_count <> imported_count + skipped_count + COALESCE(error_count, 0)
      OR (total_rows <> 0 AND processed_count > total_rows)
      OR (status = 'succeeded' AND total_rows <> processed_count)
  ) AS invalid_progress,
  count(*) FILTER (
    WHERE NOT (
      (
        status = 'failed'
        AND safe_error_code IS NOT NULL
        AND char_length(safe_error_code) BETWEEN 1 AND 100
        AND safe_error_code = btrim(safe_error_code)
        AND safe_error_code ~ '^[A-Z0-9][A-Z0-9_.-]*$'
        AND safe_error_summary IS NOT NULL
        AND char_length(safe_error_summary) BETWEEN 1 AND 500
        AND safe_error_summary = btrim(safe_error_summary)
      ) OR (
        status <> 'failed'
        AND safe_error_code IS NULL
        AND safe_error_summary IS NULL
      )
    )
  ) AS invalid_safe_error,
  count(*) FILTER (WHERE error IS NOT NULL) AS raw_errors,
  count(*) FILTER (
    WHERE cancellation_requested_by_operator_id IS NOT NULL
      AND cancellation_requested_at IS NULL
  ) AS invalid_cancellation,
  count(*) FILTER (
    WHERE NOT (
      (
        source_artifact_id IS NULL
        AND artifact_uploaded_at IS NULL
        AND artifact_deleted_at IS NULL
      ) OR (
        source_artifact_id IS NOT NULL
        AND artifact_uploaded_at IS NOT NULL
        AND (artifact_deleted_at IS NULL OR artifact_deleted_at >= artifact_uploaded_at)
      )
    )
  ) AS invalid_artifact
FROM public.import_jobs;
```

Expected: every count is `0`.

Check active-source uniqueness separately:

```sql
SELECT source, count(*)
FROM public.import_jobs
WHERE status IN ('queued', 'running')
GROUP BY source
HAVING count(*) > 1;
```

Expected: no rows.

Inspect the existing foreign keys by `pg_constraint.conkey`, referenced table
and referenced column, not by assumed long names. PostgreSQL truncates
identifiers to 63 bytes, so the 0017 cancellation key can have a shorter
catalog name than the source migration text.

## Final Contract

Migration 0018:

- makes `processed_count` `NOT NULL`;
- removes transitional defaults from `status`, `mode`, `initiator_kind` and
  `updated_at`;
- retains `created_at DEFAULT now()`;
- removes physical column `error` only after proving all values are `NULL`;
- keeps exactly `queued`, `running`, `succeeded`, `failed`, `cancelled`;
- enforces the final lifecycle, initiator, progress, safe-error and timestamp
  checks;
- preserves the artifact and cancellation checks;
- preserves all existing indexes, including both retention anchors and the
  active-source unique index, but requires every one of the six contract
  indexes to be both valid and ready before changing the schema.

`processed_count` must equal:

```text
imported_count + skipped_count + COALESCE(error_count, 0)
```

`error_count` may remain `NULL` only for a failed job whose initiator is
`legacy`. Migration 0018 does not invent a historical error count.

The final lifecycle is:

- `queued`: no `started_at` and no `finished_at`;
- `running`: `started_at`, no `finished_at`;
- `succeeded` and `failed`: both timestamps;
- `cancelled`: `finished_at` is required and `started_at` may be `NULL`.

Failed jobs require a complete bounded safe-error pair. Every other status
requires both safe-error fields to be `NULL`.

The final timestamp contract additionally requires `updated_at` to be no
earlier than `started_at` or `finished_at` whenever those timestamps exist.

## Foreign-Key Normalization

The migration discovers each existing key from its source column and target
relation. It validates that exactly one expected 0017 key exists, then drops
the catalog name through quoted dynamic SQL. This handles the actual truncated
name without editing migration 0017.

Final keys are:

- `import_jobs_started_by_operator_fk`: `started_by_operator_id` references
  `operator_users(id)` with `ON DELETE RESTRICT`;
- `import_jobs_cancel_requested_by_operator_fk`:
  `cancellation_requested_by_operator_id` references `operator_users(id)` with
  `ON DELETE SET NULL`.

Both use `ON UPDATE NO ACTION`.

## Read-Only Verification

After migration, verify:

1. migration history ends at 0018;
2. `error` is absent;
3. `processed_count` is non-nullable;
4. only `created_at` among the listed lifecycle fields retains a default;
5. all eight checks exist:
   `import_jobs_counts_check`, `import_jobs_progress_check`,
   `import_jobs_safe_error_check`, `import_jobs_lifecycle_check`,
   `import_jobs_initiator_check`, `import_jobs_timestamp_order_check`,
   `import_jobs_artifact_state_check` and
   `import_jobs_cancellation_request_check`;
6. the two short FK names and their delete actions match the contract;
7. the enum still has exactly five accepted values;
8. all six 0017 contract indexes remain present, valid and ready;
9. `import_job_diagnostics` still has RLS enabled and no browser policy;
10. the contract gate, adapted to omit the removed `error` column, returns
    zero for every category.

Do not insert or mutate business data during deployment verification.

## Deployment Order

1. Disable every import entry point and confirm no import writer is active.
2. Take and restore-test the approved backup.
3. Run the read-only contract and foreign-key preflight.
4. Apply migration 0018 by itself in the controlled migration window.
5. Run read-only schema, constraint, index and data verification.
6. Deploy code generated against the 0018 Drizzle schema.
7. Run one controlled iSing write smoke and inspect only safe job metadata.
8. Re-enable imports only after all checks pass.

Do not deploy code that no longer knows the legacy `error` column before 0018
is approved and applied. Do not run 0018 while an older writer can omit final
contract fields.

## Rollback And Forward Fix

Before commit, migration failure rolls back every schema change because the
migration runs transactionally. A preflight failure requires data or schema
investigation; do not bypass it.

After 0018 commits but before any new writer use, an approved full restore may
return to the pre-0018 restore point. Do not attempt an ad-hoc reverse migration
that recreates raw error storage or transitional defaults.

After any writer has created or updated jobs against the final contract, use a
forward fix. Keep imports disabled, preserve job IDs and safe metadata, and do
not recreate or repopulate the removed raw-error column.

## Verification Evidence

The repository test harness must execute the complete migration chain 0000–0018
against isolated `postgres:15-alpine` and `postgres:17-alpine` containers with
no persistent volume. It must verify successful finalization, every fail-fast
category, schema metadata, writer compatibility and cleanup of both containers.

This evidence is local and isolated. Migration 0018 remains unapplied to
DEVELOPMENT and production until a separate deployment approval.
