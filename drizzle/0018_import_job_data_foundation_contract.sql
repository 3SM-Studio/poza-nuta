LOCK TABLE "public"."import_jobs" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$
DECLARE
  started_by_fk_count integer;
  started_by_delete_action text;
  started_by_update_action text;
  cancellation_fk_count integer;
  cancellation_delete_action text;
  cancellation_update_action text;
  active_source_index_count integer;
  terminal_index_count integer;
  artifact_index_count integer;
  supporting_index_count integer;
BEGIN
  IF (
    SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
    FROM pg_catalog.pg_enum e
    JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'import_job_status'
  ) IS DISTINCT FROM ARRAY[
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled'
  ]::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_status_contract',
      MESSAGE = 'The import job status enum does not match the final contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "status"::text NOT IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_status_contract',
      MESSAGE = 'Import jobs contain a status outside the final contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE NOT (
      ("status" = 'queued' AND "started_at" IS NULL AND "finished_at" IS NULL)
      OR ("status" = 'running' AND "started_at" IS NOT NULL AND "finished_at" IS NULL)
      OR ("status" IN ('succeeded', 'failed') AND "started_at" IS NOT NULL AND "finished_at" IS NOT NULL)
      OR ("status" = 'cancelled' AND "finished_at" IS NOT NULL)
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_lifecycle_check',
      MESSAGE = 'Import jobs violate the final lifecycle contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE ("started_at" IS NOT NULL AND "started_at" < "created_at")
      OR (
        "finished_at" IS NOT NULL
        AND (
          "finished_at" < "created_at"
          OR ("started_at" IS NOT NULL AND "finished_at" < "started_at")
        )
      )
      OR "updated_at" IS NULL
      OR "updated_at" < "created_at"
      OR ("started_at" IS NOT NULL AND "updated_at" < "started_at")
      OR ("finished_at" IS NOT NULL AND "updated_at" < "finished_at")
      OR (
        "cancellation_requested_at" IS NOT NULL
        AND "cancellation_requested_at" < "created_at"
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_timestamp_order_check',
      MESSAGE = 'Import jobs violate timestamp ordering.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "mode" IS NULL
      OR "initiator_kind" IS NULL
      OR NOT (
        ("initiator_kind" = 'operator' AND "started_by_operator_id" IS NOT NULL)
        OR ("initiator_kind" IN ('system', 'legacy') AND "started_by_operator_id" IS NULL)
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_initiator_check',
      MESSAGE = 'Import jobs violate the final initiator contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "processed_count" IS NULL
      OR "processed_count" < 0
      OR ("error_count" IS NOT NULL AND "error_count" < 0)
      OR (
        "error_count" IS NULL
        AND NOT ("initiator_kind" = 'legacy' AND "status" = 'failed')
      )
      OR "processed_count" <> "imported_count" + "skipped_count" + COALESCE("error_count", 0)
      OR ("total_rows" <> 0 AND "processed_count" > "total_rows")
      OR ("status" = 'succeeded' AND "total_rows" <> "processed_count")
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_progress_check',
      MESSAGE = 'Import jobs violate the final progress contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE NOT (
      (
        "status" = 'failed'
        AND "safe_error_code" IS NOT NULL
        AND char_length("safe_error_code") BETWEEN 1 AND 100
        AND "safe_error_code" = btrim("safe_error_code")
        AND "safe_error_code" ~ '^[A-Z0-9][A-Z0-9_.-]*$'
        AND "safe_error_summary" IS NOT NULL
        AND char_length("safe_error_summary") BETWEEN 1 AND 500
        AND "safe_error_summary" = btrim("safe_error_summary")
      ) OR (
        "status" <> 'failed'
        AND "safe_error_code" IS NULL
        AND "safe_error_summary" IS NULL
      )
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_safe_error_check',
      MESSAGE = 'Import jobs violate the final safe-error contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "error" IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_legacy_error_empty',
      MESSAGE = 'Legacy raw import errors must be empty before dropping the column.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "cancellation_requested_by_operator_id" IS NOT NULL
      AND "cancellation_requested_at" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_cancellation_request_check',
      MESSAGE = 'Import jobs violate the cancellation request contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE NOT (
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
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_artifact_state_check',
      MESSAGE = 'Import jobs violate the source artifact contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "public"."import_jobs"
    WHERE "status" IN ('queued', 'running')
    GROUP BY "source"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'import_jobs_one_active_per_source_idx',
      MESSAGE = 'More than one active import job exists for a source.';
  END IF;

  SELECT count(*)
  INTO active_source_index_count
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
  JOIN pg_catalog.pg_class table_class ON table_class.oid = i.indrelid
  JOIN pg_catalog.pg_namespace table_schema ON table_schema.oid = table_class.relnamespace
  WHERE table_schema.nspname = 'public'
    AND table_class.relname = 'import_jobs'
    AND index_class.relname = 'import_jobs_one_active_per_source_idx'
    AND i.indisvalid
    AND i.indisready
    AND i.indisunique
    AND i.indnkeyatts = 1
    AND i.indkey[0] = (
      SELECT a.attnum
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = table_class.oid
        AND a.attname = 'source'
        AND NOT a.attisdropped
    )
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%queued%'
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%running%';

  SELECT count(*)
  INTO terminal_index_count
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
  JOIN pg_catalog.pg_class table_class ON table_class.oid = i.indrelid
  JOIN pg_catalog.pg_namespace table_schema ON table_schema.oid = table_class.relnamespace
  WHERE table_schema.nspname = 'public'
    AND table_class.relname = 'import_jobs'
    AND index_class.relname = 'import_jobs_terminal_at_idx'
    AND i.indisvalid
    AND i.indisready
    AND NOT i.indisunique
    AND i.indnkeyatts = 1
    AND i.indkey[0] = (
      SELECT a.attnum
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = table_class.oid
        AND a.attname = 'finished_at'
        AND NOT a.attisdropped
    )
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%succeeded%'
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%failed%'
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%cancelled%'
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%finished_at IS NOT NULL%';

  SELECT count(*)
  INTO artifact_index_count
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
  JOIN pg_catalog.pg_class table_class ON table_class.oid = i.indrelid
  JOIN pg_catalog.pg_namespace table_schema ON table_schema.oid = table_class.relnamespace
  WHERE table_schema.nspname = 'public'
    AND table_class.relname = 'import_jobs'
    AND index_class.relname = 'import_jobs_artifact_uploaded_at_idx'
    AND i.indisvalid
    AND i.indisready
    AND NOT i.indisunique
    AND i.indnkeyatts = 1
    AND i.indkey[0] = (
      SELECT a.attnum
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = table_class.oid
        AND a.attname = 'artifact_uploaded_at'
        AND NOT a.attisdropped
    )
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%source_artifact_id IS NOT NULL%'
    AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%artifact_deleted_at IS NULL%';

  SELECT count(*)
  INTO supporting_index_count
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
  JOIN pg_catalog.pg_class table_class ON table_class.oid = i.indrelid
  JOIN pg_catalog.pg_namespace table_schema ON table_schema.oid = table_class.relnamespace
  WHERE table_schema.nspname = 'public'
    AND table_class.relname = 'import_jobs'
    AND i.indisvalid
    AND i.indisready
    AND NOT i.indisunique
    AND (
      (
        index_class.relname = 'import_jobs_source_status_created_at_idx'
        AND i.indnkeyatts = 3
        AND i.indkey[0] = (
          SELECT a.attnum FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = table_class.oid AND a.attname = 'source' AND NOT a.attisdropped
        )
        AND i.indkey[1] = (
          SELECT a.attnum FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = table_class.oid AND a.attname = 'status' AND NOT a.attisdropped
        )
        AND i.indkey[2] = (
          SELECT a.attnum FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = table_class.oid AND a.attname = 'created_at' AND NOT a.attisdropped
        )
      ) OR (
        index_class.relname = 'import_jobs_started_by_operator_idx'
        AND i.indnkeyatts = 1
        AND i.indkey[0] = (
          SELECT a.attnum FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = table_class.oid AND a.attname = 'started_by_operator_id' AND NOT a.attisdropped
        )
      ) OR (
        index_class.relname = 'import_jobs_cancellation_requested_by_operator_idx'
        AND i.indnkeyatts = 1
        AND i.indkey[0] = (
          SELECT a.attnum FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = table_class.oid AND a.attname = 'cancellation_requested_by_operator_id' AND NOT a.attisdropped
        )
      )
    );

  IF active_source_index_count <> 1
    OR terminal_index_count <> 1
    OR artifact_index_count <> 1
    OR supporting_index_count <> 3
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_index_contract',
      MESSAGE = 'Required import job indexes are missing or unexpected.';
  END IF;

  SELECT count(*), min(c.confdeltype::text), min(c.confupdtype::text)
  INTO started_by_fk_count, started_by_delete_action, started_by_update_action
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class source_table ON source_table.oid = c.conrelid
  JOIN pg_catalog.pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
  JOIN pg_catalog.pg_class target_table ON target_table.oid = c.confrelid
  JOIN pg_catalog.pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
  WHERE c.contype = 'f'
    AND source_schema.nspname = 'public'
    AND source_table.relname = 'import_jobs'
    AND target_schema.nspname = 'public'
    AND target_table.relname = 'operator_users'
    AND c.conkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = source_table.oid
          AND a.attname = 'started_by_operator_id'
          AND NOT a.attisdropped
      )
    ]::smallint[]
    AND c.confkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = target_table.oid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
    ]::smallint[];

  IF started_by_fk_count <> 1
    OR started_by_delete_action <> 'n'
    OR started_by_update_action <> 'a'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_started_by_operator_fk_source',
      MESSAGE = 'The existing started-by operator foreign key is missing or unexpected.';
  END IF;

  SELECT count(*), min(c.confdeltype::text), min(c.confupdtype::text)
  INTO cancellation_fk_count, cancellation_delete_action, cancellation_update_action
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class source_table ON source_table.oid = c.conrelid
  JOIN pg_catalog.pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
  JOIN pg_catalog.pg_class target_table ON target_table.oid = c.confrelid
  JOIN pg_catalog.pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
  WHERE c.contype = 'f'
    AND source_schema.nspname = 'public'
    AND source_table.relname = 'import_jobs'
    AND target_schema.nspname = 'public'
    AND target_table.relname = 'operator_users'
    AND c.conkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = source_table.oid
          AND a.attname = 'cancellation_requested_by_operator_id'
          AND NOT a.attisdropped
      )
    ]::smallint[]
    AND c.confkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = target_table.oid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
    ]::smallint[];

  IF cancellation_fk_count <> 1
    OR cancellation_delete_action <> 'n'
    OR cancellation_update_action <> 'a'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'import_jobs_cancel_requested_by_operator_fk_source',
      MESSAGE = 'The existing cancellation operator foreign key is missing or unexpected.';
  END IF;
END;
$$;--> statement-breakpoint
DO $$
DECLARE
  existing_constraint_name text;
BEGIN
  SELECT c.conname
  INTO STRICT existing_constraint_name
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class source_table ON source_table.oid = c.conrelid
  JOIN pg_catalog.pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
  JOIN pg_catalog.pg_class target_table ON target_table.oid = c.confrelid
  JOIN pg_catalog.pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
  WHERE c.contype = 'f'
    AND source_schema.nspname = 'public'
    AND source_table.relname = 'import_jobs'
    AND target_schema.nspname = 'public'
    AND target_table.relname = 'operator_users'
    AND c.conkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = source_table.oid
          AND a.attname = 'started_by_operator_id'
          AND NOT a.attisdropped
      )
    ]::smallint[]
    AND c.confkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = target_table.oid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
    ]::smallint[];

  EXECUTE format(
    'ALTER TABLE %I.%I DROP CONSTRAINT %I',
    'public',
    'import_jobs',
    existing_constraint_name
  );

  SELECT c.conname
  INTO STRICT existing_constraint_name
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class source_table ON source_table.oid = c.conrelid
  JOIN pg_catalog.pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
  JOIN pg_catalog.pg_class target_table ON target_table.oid = c.confrelid
  JOIN pg_catalog.pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
  WHERE c.contype = 'f'
    AND source_schema.nspname = 'public'
    AND source_table.relname = 'import_jobs'
    AND target_schema.nspname = 'public'
    AND target_table.relname = 'operator_users'
    AND c.conkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = source_table.oid
          AND a.attname = 'cancellation_requested_by_operator_id'
          AND NOT a.attisdropped
      )
    ]::smallint[]
    AND c.confkey = ARRAY[
      (
        SELECT a.attnum
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = target_table.oid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
    ]::smallint[];

  EXECUTE format(
    'ALTER TABLE %I.%I DROP CONSTRAINT %I',
    'public',
    'import_jobs',
    existing_constraint_name
  );
END;
$$;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_started_by_operator_fk"
FOREIGN KEY ("started_by_operator_id")
REFERENCES "public"."operator_users"("id")
ON DELETE RESTRICT
ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_cancel_requested_by_operator_fk"
FOREIGN KEY ("cancellation_requested_by_operator_id")
REFERENCES "public"."operator_users"("id")
ON DELETE SET NULL
ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" DROP CONSTRAINT "import_jobs_expand_counts_check";--> statement-breakpoint
ALTER TABLE "public"."import_jobs" DROP CONSTRAINT "import_jobs_safe_error_pair_check";--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "mode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "initiator_kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "processed_count" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."import_jobs" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_progress_check" CHECK (
  "processed_count" >= 0
  AND ("error_count" IS NULL OR "error_count" >= 0)
  AND (
    "error_count" IS NOT NULL
    OR ("initiator_kind" = 'legacy' AND "status" = 'failed')
  )
  AND "processed_count" = "imported_count" + "skipped_count" + COALESCE("error_count", 0)
  AND ("total_rows" = 0 OR "processed_count" <= "total_rows")
  AND ("status" <> 'succeeded' OR "total_rows" = "processed_count")
);--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_safe_error_check" CHECK (
  (
    "status" = 'failed'
    AND "safe_error_code" IS NOT NULL
    AND char_length("safe_error_code") BETWEEN 1 AND 100
    AND "safe_error_code" = btrim("safe_error_code")
    AND "safe_error_code" ~ '^[A-Z0-9][A-Z0-9_.-]*$'
    AND "safe_error_summary" IS NOT NULL
    AND char_length("safe_error_summary") BETWEEN 1 AND 500
    AND "safe_error_summary" = btrim("safe_error_summary")
  ) OR (
    "status" <> 'failed'
    AND "safe_error_code" IS NULL
    AND "safe_error_summary" IS NULL
  )
);--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_lifecycle_check" CHECK (
  ("status" = 'queued' AND "started_at" IS NULL AND "finished_at" IS NULL)
  OR ("status" = 'running' AND "started_at" IS NOT NULL AND "finished_at" IS NULL)
  OR ("status" IN ('succeeded', 'failed') AND "started_at" IS NOT NULL AND "finished_at" IS NOT NULL)
  OR ("status" = 'cancelled' AND "finished_at" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_initiator_check" CHECK (
  ("initiator_kind" = 'operator' AND "started_by_operator_id" IS NOT NULL)
  OR ("initiator_kind" IN ('system', 'legacy') AND "started_by_operator_id" IS NULL)
);--> statement-breakpoint
ALTER TABLE "public"."import_jobs"
ADD CONSTRAINT "import_jobs_timestamp_order_check" CHECK (
  ("started_at" IS NULL OR "started_at" >= "created_at")
  AND (
    "finished_at" IS NULL
    OR (
      "finished_at" >= "created_at"
      AND ("started_at" IS NULL OR "finished_at" >= "started_at")
    )
  )
  AND "updated_at" >= "created_at"
  AND ("started_at" IS NULL OR "updated_at" >= "started_at")
  AND ("finished_at" IS NULL OR "updated_at" >= "finished_at")
  AND (
    "cancellation_requested_at" IS NULL
    OR "cancellation_requested_at" >= "created_at"
  )
);
