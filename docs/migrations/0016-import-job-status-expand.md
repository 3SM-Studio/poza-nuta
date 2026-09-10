# Migration 0016: Import Job Status Expand

## Purpose

Migration `0016_import_job_status_expand` is the expand-only phase of the
Import Job Data Foundation. It keeps the legacy `pending`, `running`, `done`,
and `failed` values valid while adding `queued`, `succeeded`, and `cancelled`.

This migration does not backfill records, change `import_jobs`, or implement
the complete Ticket 11 lifecycle.

## SQL

```sql
ALTER TYPE "public"."import_job_status" ADD VALUE 'queued';
ALTER TYPE "public"."import_job_status" ADD VALUE 'succeeded';
ALTER TYPE "public"."import_job_status" ADD VALUE 'cancelled';
```

The new enum values are not used by DML in this migration. Existing writers
that use `pending`, `running`, `done`, or `failed` remain compatible after
`0016` is committed.

## Deployment Order

1. Take the required backup or restore point and obtain separate migration
   approval.
2. Apply and commit migration `0016`.
3. Verify the enum values and confirm that `import_jobs` data and structure are
   unchanged.
4. Only then deploy the compatible iSing writer that records successful jobs
   as `succeeded`.

Do not deploy the new writer before migration `0016`. Do not apply the future
Ticket 11B migration in this phase. Migration `0016` is not the complete
Ticket 11 implementation.

## Read-Only Verification

Verify the ordered enum values:

```sql
SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace
WHERE pg_namespace.nspname = 'public'
  AND pg_type.typname = 'import_job_status'
ORDER BY enumsortorder;
```

Expected order:

```text
pending, running, done, failed, queued, succeeded, cancelled
```

Compare the `public.import_jobs` columns, constraints, indexes, and row counts
with the pre-migration record. They must be unchanged.

After the writer deployment, a controlled development import may verify that
the job starts as `running`, ends as `succeeded`, and stores only
`IMPORT_FAILED` in the legacy `error` field on failure.

## Rollback And Forward Fix

PostgreSQL enum values cannot be safely removed. Do not roll back this
migration by dropping or recreating the enum type on an existing database.
Before the new writer is deployed, application rollback needs no database
change because all legacy values remain valid.

After deployment, use a forward fix. A writer rollback that can emit `done`
remains database-compatible, but it must not be treated as removal of the new
enum values. Ticket 11B will be a separate phase after the Ticket 11A migration
and writer deployment have been confirmed.

## Execution Status

Migration `0016` has not been run on Supabase or any existing database as part
of this ticket. PostgreSQL verification uses only an isolated, disposable test
database.
