LOCK TABLE "public"."import_jobs" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "status"::text IN ('done', 'failed', 'succeeded', 'cancelled')
      AND "finished_at" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_terminal_timestamp_required',
      MESSAGE = 'Terminal import jobs must have finished_at before migration 0017.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "status"::text IN ('pending', 'queued', 'running')
    GROUP BY "source"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'import_jobs_one_active_per_source_idx',
      MESSAGE = 'More than one active import job exists for a source.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "total_rows" <> 0
      AND "imported_count" + "skipped_count" > "total_rows"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_expand_counts_check',
      MESSAGE = 'Known import job outcomes exceed total_rows.';
  END IF;
END;
$$;--> statement-breakpoint
CREATE TYPE "public"."import_job_mode" AS ENUM('validate', 'dry_run', 'write');--> statement-breakpoint
CREATE TYPE "public"."import_job_initiator_kind" AS ENUM('operator', 'system', 'legacy');--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "mode" "public"."import_job_mode";--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "initiator_kind" "public"."import_job_initiator_kind";--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "processed_count" integer;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "error_count" integer;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "safe_error_code" text;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "safe_error_summary" text;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "cancellation_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "cancellation_requested_by_operator_id" bigint;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "source_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "artifact_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ADD COLUMN "artifact_deleted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "public"."import_jobs"
SET
  "mode" = 'write',
  "initiator_kind" = CASE
    WHEN "started_by_operator_id" IS NOT NULL THEN 'operator'::"public"."import_job_initiator_kind"
    ELSE 'legacy'::"public"."import_job_initiator_kind"
  END,
  "processed_count" = "imported_count" + "skipped_count",
  "error_count" = CASE
    WHEN "status"::text = 'failed' THEN NULL
    ELSE 0
  END,
  "safe_error_code" = CASE
    WHEN "status"::text = 'failed' THEN 'LEGACY_IMPORT_FAILURE'
    ELSE NULL
  END,
  "safe_error_summary" = CASE
    WHEN "status"::text = 'failed'
      THEN 'A legacy import failed. Historical error details were not retained.'
    ELSE NULL
  END,
  "started_at" = CASE
    WHEN "status"::text IN ('running', 'done', 'failed', 'succeeded', 'cancelled')
      THEN "created_at"
    ELSE NULL
  END,
  "updated_at" = COALESCE("finished_at", "created_at");--> statement-breakpoint
UPDATE "public"."import_jobs"
SET "error" = NULL
WHERE "error" IS NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "mode" IS NULL
      OR "initiator_kind" IS NULL
      OR "updated_at" IS NULL
      OR "processed_count" IS NULL
      OR (
        "status"::text <> 'failed'
        AND "error_count" IS NULL
      )
      OR (
        "status"::text = 'failed'
        AND (
          "safe_error_code" IS NULL
          OR "safe_error_summary" IS NULL
        )
      )
      OR (
        "status"::text IN ('running', 'done', 'failed', 'succeeded', 'cancelled')
        AND "started_at" IS NULL
      )
      OR "error" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Import job expand backfill is incomplete.';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "mode" SET DEFAULT 'write';--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "mode" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "initiator_kind" SET DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "initiator_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
CREATE TYPE "public"."import_job_status_0017" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ALTER COLUMN "status" TYPE "public"."import_job_status_0017"
USING (
  CASE "status"::text
    WHEN 'pending' THEN 'queued'
    WHEN 'running' THEN 'running'
    WHEN 'done' THEN 'succeeded'
    WHEN 'succeeded' THEN 'succeeded'
    WHEN 'failed' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
  END
)::"public"."import_job_status_0017";--> statement-breakpoint
DROP TYPE "public"."import_job_status";--> statement-breakpoint
ALTER TYPE "public"."import_job_status_0017" RENAME TO "import_job_status";--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
CREATE TABLE "public"."import_job_diagnostics" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "import_job_id" bigint NOT NULL,
  "code" text NOT NULL,
  "safe_summary" text NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "import_job_diagnostics_import_job_id_import_jobs_id_fk"
    FOREIGN KEY ("import_job_id")
    REFERENCES "public"."import_jobs"("id")
    ON DELETE cascade
    ON UPDATE no action,
  CONSTRAINT "import_job_diagnostics_code_check" CHECK (
    char_length("code") between 1 and 100
    AND "code" = btrim("code")
    AND "code" ~ '^[A-Z0-9][A-Z0-9_.-]*$'
  ),
  CONSTRAINT "import_job_diagnostics_summary_check" CHECK (
    char_length("safe_summary") between 1 and 500
    AND "safe_summary" = btrim("safe_summary")
  )
);--> statement-breakpoint
ALTER TABLE "public"."import_job_diagnostics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_cancellation_requested_by_operator_id_operator_users_id_fk"
FOREIGN KEY ("cancellation_requested_by_operator_id")
REFERENCES "public"."operator_users"("id")
ON DELETE set null
ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_expand_counts_check" CHECK (
  ("processed_count" IS NULL OR "processed_count" >= 0)
  AND ("error_count" IS NULL OR "error_count" >= 0)
  AND (
    "processed_count" IS NULL
    OR "error_count" IS NULL
    OR "processed_count" = "imported_count" + "skipped_count" + "error_count"
  )
  AND (
    "processed_count" IS NULL
    OR "total_rows" = 0
    OR "processed_count" <= "total_rows"
  )
);--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_safe_error_pair_check" CHECK (
  (
    "safe_error_code" IS NULL
    AND "safe_error_summary" IS NULL
  ) OR (
    "safe_error_code" IS NOT NULL
    AND char_length("safe_error_code") between 1 and 100
    AND "safe_error_code" = btrim("safe_error_code")
    AND "safe_error_code" ~ '^[A-Z0-9][A-Z0-9_.-]*$'
    AND "safe_error_summary" IS NOT NULL
    AND char_length("safe_error_summary") between 1 and 500
    AND "safe_error_summary" = btrim("safe_error_summary")
  )
);--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_artifact_state_check" CHECK (
  (
    "source_artifact_id" IS NULL
    AND "artifact_uploaded_at" IS NULL
    AND "artifact_deleted_at" IS NULL
  ) OR (
    "source_artifact_id" IS NOT NULL
    AND "artifact_uploaded_at" IS NOT NULL
    AND (
      "artifact_deleted_at" IS NULL
      OR "artifact_deleted_at" >= "artifact_uploaded_at"
    )
  )
);--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_cancellation_request_check" CHECK (
  "cancellation_requested_by_operator_id" IS NULL
  OR "cancellation_requested_at" IS NOT NULL
);--> statement-breakpoint
CREATE INDEX "import_job_diagnostics_job_recorded_at_idx"
ON "public"."import_job_diagnostics" USING btree ("import_job_id", "recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_job_diagnostics_recorded_at_idx"
ON "public"."import_job_diagnostics" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "import_jobs_cancellation_requested_by_operator_idx"
ON "public"."import_jobs" USING btree ("cancellation_requested_by_operator_id");--> statement-breakpoint
CREATE INDEX "import_jobs_terminal_at_idx"
ON "public"."import_jobs" USING btree ("finished_at")
WHERE "status" IN ('succeeded', 'failed', 'cancelled')
  AND "finished_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "import_jobs_artifact_uploaded_at_idx"
ON "public"."import_jobs" USING btree ("artifact_uploaded_at")
WHERE "source_artifact_id" IS NOT NULL
  AND "artifact_deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_one_active_per_source_idx"
ON "public"."import_jobs" USING btree ("source")
WHERE "status" IN ('queued', 'running');
