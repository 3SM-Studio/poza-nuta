LOCK TABLE "public"."import_jobs", "public"."operator_audit_log"
IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

DO $$
DECLARE
  import_job_columns text[];
  audit_columns text[];
  import_constraints text[];
  import_indexes text[];
  started_by_delete_action "char";
  cancellation_delete_action "char";
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "status" IN ('queued', 'running')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_migration_active_jobs',
      MESSAGE = 'Import worker migration requires all import jobs to be terminal.';
  END IF;

  IF (
    SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
    FROM pg_catalog.pg_enum e
    JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'import_job_status'
  ) IS DISTINCT FROM ARRAY[
    'queued', 'running', 'succeeded', 'failed', 'cancelled'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_status_contract',
      MESSAGE = 'Import job statuses do not match migration 0018.';
  END IF;

  IF (
    SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
    FROM pg_catalog.pg_enum e
    JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'import_job_mode'
  ) IS DISTINCT FROM ARRAY['validate', 'dry_run', 'write']::text[]
  OR (
    SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
    FROM pg_catalog.pg_enum e
    JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'import_job_initiator_kind'
  ) IS DISTINCT FROM ARRAY['operator', 'system', 'legacy']::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_enum_contract',
      MESSAGE = 'Import job enums do not match migration 0018.';
  END IF;

  SELECT array_agg(c.column_name::text ORDER BY c.column_name)
  INTO import_job_columns
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'import_jobs';

  IF import_job_columns IS DISTINCT FROM ARRAY[
    'artifact_deleted_at', 'artifact_uploaded_at',
    'cancellation_requested_at',
    'cancellation_requested_by_operator_id', 'created_at', 'error_count',
    'finished_at', 'id', 'imported_count', 'initiator_kind', 'mode',
    'processed_count', 'safe_error_code', 'safe_error_summary',
    'skipped_count', 'source', 'source_artifact_id', 'started_at',
    'started_by_operator_id', 'status', 'total_rows', 'updated_at'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_column_contract',
      MESSAGE = 'Import job columns do not match migration 0018.';
  END IF;

  SELECT array_agg(c.column_name::text ORDER BY c.column_name)
  INTO audit_columns
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'operator_audit_log';

  IF audit_columns IS DISTINCT FROM ARRAY[
    'action', 'created_at', 'entity_id', 'event_id', 'id', 'operator_id',
    'payload'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_audit_column_contract',
      MESSAGE = 'Audit columns do not match the pre-worker contract.';
  END IF;

  SELECT array_agg(c.conname::text ORDER BY c.conname)
  INTO import_constraints
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.import_jobs'::regclass
    AND c.contype = 'c'
    AND c.convalidated;

  IF import_constraints IS DISTINCT FROM ARRAY[
    'import_jobs_artifact_state_check',
    'import_jobs_cancellation_request_check',
    'import_jobs_counts_check',
    'import_jobs_initiator_check',
    'import_jobs_lifecycle_check',
    'import_jobs_progress_check',
    'import_jobs_safe_error_check',
    'import_jobs_timestamp_order_check'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_constraint_contract',
      MESSAGE = 'Import job constraints do not match migration 0018.';
  END IF;

  SELECT array_agg(index_class.relname::text ORDER BY index_class.relname)
  INTO import_indexes
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class table_class ON table_class.oid = i.indrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = table_class.relnamespace
  JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
  WHERE n.nspname = 'public'
    AND table_class.relname = 'import_jobs'
    AND NOT i.indisprimary
    AND i.indisvalid
    AND i.indisready;

  IF import_indexes IS DISTINCT FROM ARRAY[
    'import_jobs_artifact_uploaded_at_idx',
    'import_jobs_cancellation_requested_by_operator_idx',
    'import_jobs_one_active_per_source_idx',
    'import_jobs_source_status_created_at_idx',
    'import_jobs_started_by_operator_idx',
    'import_jobs_terminal_at_idx'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_index_contract',
      MESSAGE = 'Import job indexes do not match migration 0018.';
  END IF;

  SELECT c.confdeltype
  INTO started_by_delete_action
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.import_jobs'::regclass
    AND c.conname = 'import_jobs_started_by_operator_fk'
    AND c.contype = 'f';

  SELECT c.confdeltype
  INTO cancellation_delete_action
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.import_jobs'::regclass
    AND c.conname = 'import_jobs_cancel_requested_by_operator_fk'
    AND c.contype = 'f';

  IF started_by_delete_action IS DISTINCT FROM 'r'::"char"
  OR cancellation_delete_action IS DISTINCT FROM 'n'::"char" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_fk_contract',
      MESSAGE = 'Import job foreign keys do not match migration 0018.';
  END IF;

  IF (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'import_jobs'
  ) IS DISTINCT FROM true OR (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'import_job_diagnostics'
  ) IS DISTINCT FROM true OR (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'operator_audit_log'
  ) IS DISTINCT FROM true OR (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'songs'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_rls_contract',
      MESSAGE = 'Required worker tables must have row-level security enabled.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'import_job_diagnostics'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_diagnostics_policy_contract',
      MESSAGE = 'Import diagnostics have unexpected pre-worker policies.';
  END IF;

  IF to_regtype('public.audit_actor_kind') IS NOT NULL
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'import_worker')
  OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'import_jobs'
      AND column_name IN (
        'attempt_count', 'claim_token', 'lease_expires_at', 'heartbeat_at'
      )
  )
  OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'operator_audit_log'
      AND column_name = 'actor_kind'
  )
  OR to_regclass('public.import_jobs_queued_claim_idx') IS NOT NULL
  OR to_regclass('public.import_jobs_recovery_idx') IS NOT NULL
  OR to_regclass('public.import_jobs_claim_token_idx') IS NOT NULL
  OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname = 'protect_terminal_import_job'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_job_worker_objects_absent',
      MESSAGE = 'Import worker foundation objects already exist.';
  END IF;
END
$$;--> statement-breakpoint

CREATE TYPE "public"."audit_actor_kind" AS ENUM (
  'operator',
  'system',
  'legacy'
);--> statement-breakpoint

ALTER TABLE "public"."import_jobs"
ADD COLUMN "attempt_count" integer;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint

UPDATE "public"."import_jobs"
SET "attempt_count" = 0
WHERE "attempt_count" IS NULL;--> statement-breakpoint

ALTER TABLE "public"."import_jobs"
ALTER COLUMN "attempt_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ALTER COLUMN "attempt_count" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "public"."operator_audit_log"
ADD COLUMN "actor_kind" "public"."audit_actor_kind";--> statement-breakpoint

UPDATE "public"."operator_audit_log"
SET "actor_kind" = CASE
  WHEN "operator_id" IS NULL THEN 'legacy'::"public"."audit_actor_kind"
  ELSE 'operator'::"public"."audit_actor_kind"
END
WHERE "actor_kind" IS NULL;--> statement-breakpoint

ALTER TABLE "public"."operator_audit_log"
ALTER COLUMN "actor_kind" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "public"."operator_audit_log"
ADD CONSTRAINT "operator_audit_log_actor_check" CHECK (
  "actor_kind" = 'operator'
  OR (
    "actor_kind" IN ('system', 'legacy')
    AND "operator_id" IS NULL
  )
);--> statement-breakpoint

ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_worker_attempt_check" CHECK (
  "attempt_count" BETWEEN 0 AND 3
);--> statement-breakpoint

ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_worker_claim_check" CHECK (
  (
    "status" = 'queued'
    AND "attempt_count" = 0
    AND "claim_token" IS NULL
    AND "lease_expires_at" IS NULL
    AND "heartbeat_at" IS NULL
  ) OR (
    "status" = 'running'
    AND "attempt_count" BETWEEN 1 AND 3
    AND "claim_token" IS NOT NULL
    AND "lease_expires_at" IS NOT NULL
    AND "heartbeat_at" IS NOT NULL
  ) OR (
    "status" IN ('succeeded', 'failed', 'cancelled')
    AND "claim_token" IS NULL
    AND "lease_expires_at" IS NULL
    AND "heartbeat_at" IS NULL
  )
);--> statement-breakpoint

ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_worker_lease_check" CHECK (
  ("heartbeat_at" IS NULL OR "heartbeat_at" >= "started_at")
  AND (
    "lease_expires_at" IS NULL
    OR "lease_expires_at" >= "heartbeat_at"
  )
);--> statement-breakpoint

CREATE INDEX "import_jobs_queued_claim_idx"
ON "public"."import_jobs" USING btree ("created_at", "id")
WHERE "status" = 'queued';--> statement-breakpoint

CREATE INDEX "import_jobs_recovery_idx"
ON "public"."import_jobs" USING btree ("lease_expires_at", "id")
WHERE "status" = 'running';--> statement-breakpoint

CREATE UNIQUE INDEX "import_jobs_claim_token_idx"
ON "public"."import_jobs" USING btree ("claim_token")
WHERE "claim_token" IS NOT NULL;--> statement-breakpoint

CREATE FUNCTION "private"."protect_terminal_import_job"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD."cancellation_requested_by_operator_id" IS NOT NULL
  AND NEW."cancellation_requested_by_operator_id" IS NULL
  AND (
    pg_catalog.to_jsonb(NEW) - 'cancellation_requested_by_operator_id'
  ) IS NOT DISTINCT FROM (
    pg_catalog.to_jsonb(OLD) - 'cancellation_requested_by_operator_id'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '23514',
    CONSTRAINT = 'import_jobs_terminal_immutable',
    MESSAGE = 'Terminal import jobs are immutable.';
END
$$;--> statement-breakpoint

CREATE TRIGGER "protect_terminal_import_job_update"
BEFORE UPDATE ON "public"."import_jobs"
FOR EACH ROW
WHEN (OLD."status" IN ('succeeded', 'failed', 'cancelled'))
EXECUTE FUNCTION "private"."protect_terminal_import_job"();--> statement-breakpoint

CREATE ROLE "import_worker"
NOLOGIN
NOSUPERUSER
NOCREATEDB
NOCREATEROLE
NOINHERIT
NOREPLICATION
NOBYPASSRLS;--> statement-breakpoint

REVOKE ALL ON TABLE
  "public"."import_jobs",
  "public"."import_job_diagnostics",
  "public"."operator_audit_log",
  "public"."songs"
FROM "import_worker";--> statement-breakpoint

REVOKE CREATE ON SCHEMA "public" FROM "import_worker";--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO "import_worker";--> statement-breakpoint
GRANT USAGE ON TYPE
  "public"."audit_actor_kind",
  "public"."import_job_status",
  "public"."import_source",
  "public"."import_job_mode",
  "public"."import_job_initiator_kind",
  "public"."song_source"
TO "import_worker";--> statement-breakpoint

GRANT SELECT, UPDATE ON TABLE "public"."import_jobs"
TO "import_worker";--> statement-breakpoint
GRANT INSERT ON TABLE "public"."import_job_diagnostics"
TO "import_worker";--> statement-breakpoint
GRANT INSERT ON TABLE "public"."operator_audit_log"
TO "import_worker";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."songs"
TO "import_worker";--> statement-breakpoint

GRANT USAGE ON SEQUENCE
  "public"."import_job_diagnostics_id_seq",
  "public"."operator_audit_log_id_seq",
  "public"."songs_id_seq"
TO "import_worker";--> statement-breakpoint

CREATE POLICY "import_worker_select_import_jobs"
ON "public"."import_jobs"
FOR SELECT
TO "import_worker"
USING (true);--> statement-breakpoint

CREATE POLICY "import_worker_update_import_jobs"
ON "public"."import_jobs"
FOR UPDATE
TO "import_worker"
USING ("status" IN ('queued', 'running'))
WITH CHECK ("status" IN ('running', 'succeeded', 'failed', 'cancelled'));--> statement-breakpoint

CREATE POLICY "import_worker_insert_import_job_diagnostics"
ON "public"."import_job_diagnostics"
FOR INSERT
TO "import_worker"
WITH CHECK (true);--> statement-breakpoint

CREATE POLICY "import_worker_insert_operator_audit_log"
ON "public"."operator_audit_log"
FOR INSERT
TO "import_worker"
WITH CHECK (
  "actor_kind" = 'system'
  AND "operator_id" IS NULL
  AND "event_id" IS NULL
  AND "action" IN ('import.complete', 'import.fail')
);--> statement-breakpoint

CREATE POLICY "import_worker_select_songs"
ON "public"."songs"
FOR SELECT
TO "import_worker"
USING (true);--> statement-breakpoint

CREATE POLICY "import_worker_insert_songs"
ON "public"."songs"
FOR INSERT
TO "import_worker"
WITH CHECK (true);--> statement-breakpoint

CREATE POLICY "import_worker_update_songs"
ON "public"."songs"
FOR UPDATE
TO "import_worker"
USING (true)
WITH CHECK (true);--> statement-breakpoint

REVOKE ALL ON FUNCTION "private"."protect_terminal_import_job"()
FROM PUBLIC, "anon", "authenticated", "import_worker";
