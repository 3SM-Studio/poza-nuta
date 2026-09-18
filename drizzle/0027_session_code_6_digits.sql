SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
DO $$
DECLARE
  invalid_event_codes bigint;
  invalid_history_codes bigint;
  active_or_scheduled_events bigint;
  pairing_violations bigint;
  orphan_current_history bigint;
  duplicate_event_codes bigint;
  duplicate_history_codes bigint;
  legacy_code_count bigint;
  events_default text;
BEGIN
  SELECT column_default
  INTO events_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'events'
    AND column_name = 'session_code'
    AND data_type = 'text'
    AND is_nullable = 'NO';

  IF events_default IS NULL
     OR events_default NOT LIKE '%100000000%'
     OR events_default NOT LIKE '%8, ''0''%'
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'event_session_codes'
         AND column_name = 'code'
         AND data_type = 'text'
         AND is_nullable = 'NO'
         AND column_default IS NULL
     )
     OR EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'event_session_codes'
         AND column_name = 'legacy_code'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint AS constraint_metadata
       WHERE constraint_metadata.conrelid = 'public.events'::regclass
         AND constraint_metadata.conname = 'events_session_code_format_check'
         AND constraint_metadata.contype = 'c'
         AND constraint_metadata.convalidated
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%^[0-9]{8}$%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint AS constraint_metadata
       WHERE constraint_metadata.conrelid = 'public.event_session_codes'::regclass
         AND constraint_metadata.conname = 'event_session_codes_code_format_check'
         AND constraint_metadata.contype = 'c'
         AND constraint_metadata.convalidated
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%^[0-9]{8}$%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index AS index_metadata
       JOIN pg_class AS index_relation
         ON index_relation.oid = index_metadata.indexrelid
       JOIN pg_namespace AS index_schema
         ON index_schema.oid = index_relation.relnamespace
       WHERE index_schema.nspname = 'public'
         AND index_relation.relname = 'events_session_code_idx'
         AND index_metadata.indrelid = 'public.events'::regclass
         AND index_metadata.indisunique
         AND index_metadata.indisvalid
         AND index_metadata.indisready
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index AS index_metadata
       JOIN pg_class AS index_relation
         ON index_relation.oid = index_metadata.indexrelid
       JOIN pg_namespace AS index_schema
         ON index_schema.oid = index_relation.relnamespace
       WHERE index_schema.nspname = 'public'
         AND index_relation.relname = 'event_session_codes_code_idx'
         AND index_metadata.indrelid = 'public.event_session_codes'::regclass
         AND index_metadata.indisunique
         AND index_metadata.indisvalid
         AND index_metadata.indisready
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index AS index_metadata
       JOIN pg_class AS index_relation
         ON index_relation.oid = index_metadata.indexrelid
       JOIN pg_namespace AS index_schema
         ON index_schema.oid = index_relation.relnamespace
       WHERE index_schema.nspname = 'public'
         AND index_relation.relname = 'event_sessions_event_id_idx'
         AND index_metadata.indrelid = 'public.event_sessions'::regclass
         AND index_metadata.indisunique
         AND index_metadata.indisvalid
         AND index_metadata.indisready
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index AS index_metadata
       JOIN pg_class AS index_relation
         ON index_relation.oid = index_metadata.indexrelid
       JOIN pg_namespace AS index_schema
         ON index_schema.oid = index_relation.relnamespace
       WHERE index_schema.nspname = 'public'
         AND index_relation.relname = 'event_session_codes_current_session_idx'
         AND index_metadata.indrelid = 'public.event_session_codes'::regclass
         AND index_metadata.indisunique
         AND index_metadata.indisvalid
         AND index_metadata.indisready
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'session_code_legacy_schema_preflight',
      MESSAGE = 'The pre-0027 session-code schema does not match the expected eight-digit contract';
  END IF;

  SELECT count(*) INTO invalid_event_codes
  FROM public.events
  WHERE session_code IS NULL
     OR length(session_code) <> 8
     OR octet_length(translate(session_code, '0123456789', '')) <> 0;

  SELECT count(*) INTO invalid_history_codes
  FROM public.event_session_codes
  WHERE code IS NULL
     OR length(code) <> 8
     OR octet_length(translate(code, '0123456789', '')) <> 0;

  IF invalid_event_codes <> 0 OR invalid_history_codes <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'session_code_legacy_data_preflight',
      MESSAGE = 'Existing session codes do not satisfy the expected eight-digit legacy contract',
      DETAIL = format(
        'public.events invalid rows: %s; public.event_session_codes invalid rows: %s',
        invalid_event_codes,
        invalid_history_codes
      );
  END IF;

  SELECT count(*) INTO active_or_scheduled_events
  FROM public.events
  WHERE status NOT IN ('closed', 'cancelled')
    AND closed_at IS NULL
    AND (
      starts_at > transaction_timestamp()
      OR coalesce(auto_close_at, ends_at) > transaction_timestamp()
    );

  IF active_or_scheduled_events <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'session_code_legacy_active_event_preflight',
      MESSAGE = 'Active or scheduled events prevent legacy session-code remediation',
      DETAIL = format('blocking events: %s', active_or_scheduled_events);
  END IF;

  SELECT count(*) INTO pairing_violations
  FROM (
    SELECT event.id
    FROM public.events AS event
    LEFT JOIN public.event_sessions AS session
      ON session.event_id = event.id
    LEFT JOIN public.event_session_codes AS history
      ON history.session_id = session.id
     AND history.valid_until IS NULL
     AND history.revoked_at IS NULL
    GROUP BY event.id, event.session_code
    HAVING count(DISTINCT session.id) <> 1
       OR count(history.id) <> 1
       OR min(history.code) IS DISTINCT FROM event.session_code
  ) AS invalid_pairing;

  SELECT count(*) INTO orphan_current_history
  FROM public.event_session_codes AS history
  LEFT JOIN public.event_sessions AS session
    ON session.id = history.session_id
  LEFT JOIN public.events AS event
    ON event.id = session.event_id
  WHERE history.valid_until IS NULL
    AND history.revoked_at IS NULL
    AND (
      event.id IS NULL
      OR event.session_code IS DISTINCT FROM history.code
    );

  IF pairing_violations <> 0 OR orphan_current_history <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'session_code_legacy_pairing_preflight',
      MESSAGE = 'Event and current session-code history pairing is not deterministic',
      DETAIL = format(
        'event pairing violations: %s; orphan or mismatched current history rows: %s',
        pairing_violations,
        orphan_current_history
      );
  END IF;

  SELECT count(*) - count(DISTINCT session_code)
  INTO duplicate_event_codes
  FROM public.events;

  SELECT count(*) - count(DISTINCT code), count(DISTINCT code)
  INTO duplicate_history_codes, legacy_code_count
  FROM public.event_session_codes;

  IF duplicate_event_codes <> 0 OR duplicate_history_codes <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'session_code_legacy_uniqueness_preflight',
      MESSAGE = 'Legacy session-code uniqueness does not match the expected invariants',
      DETAIL = format(
        'duplicate event rows: %s; duplicate history rows: %s',
        duplicate_event_codes,
        duplicate_history_codes
      );
  END IF;

  IF legacy_code_count > 1000000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '54000',
      CONSTRAINT = 'session_code_legacy_capacity_preflight',
      MESSAGE = 'Legacy session-code history exceeds the strict six-digit namespace',
      DETAIL = format('unique legacy codes: %s; namespace capacity: 1000000', legacy_code_count);
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "public"."events"
  DROP CONSTRAINT "events_session_code_format_check";
--> statement-breakpoint
LOCK TABLE "public"."event_sessions" IN SHARE MODE;
--> statement-breakpoint
ALTER TABLE "public"."event_session_codes"
  ADD COLUMN "legacy_code" text;
--> statement-breakpoint
ALTER TABLE "public"."event_session_codes"
  DROP CONSTRAINT "event_session_codes_code_format_check";
--> statement-breakpoint
DO $$
DECLARE
  invalid_event_codes bigint;
  invalid_history_codes bigint;
  active_or_scheduled_events bigint;
  pairing_violations bigint;
  legacy_code_count bigint;
BEGIN
  SELECT count(*) INTO invalid_event_codes
  FROM public.events
  WHERE session_code IS NULL
     OR length(session_code) <> 8
     OR octet_length(translate(session_code, '0123456789', '')) <> 0;

  SELECT count(*)
  INTO invalid_history_codes
  FROM public.event_session_codes
  WHERE code IS NULL
     OR length(code) <> 8
     OR octet_length(translate(code, '0123456789', '')) <> 0;

  SELECT count(DISTINCT code)
  INTO legacy_code_count
  FROM public.event_session_codes;

  SELECT count(*) INTO active_or_scheduled_events
  FROM public.events
  WHERE status NOT IN ('closed', 'cancelled')
    AND closed_at IS NULL
    AND (
      starts_at > transaction_timestamp()
      OR coalesce(auto_close_at, ends_at) > transaction_timestamp()
    );

  SELECT count(*) INTO pairing_violations
  FROM (
    SELECT event.id
    FROM public.events AS event
    LEFT JOIN public.event_sessions AS session
      ON session.event_id = event.id
    LEFT JOIN public.event_session_codes AS history
      ON history.session_id = session.id
     AND history.valid_until IS NULL
     AND history.revoked_at IS NULL
    GROUP BY event.id, event.session_code
    HAVING count(DISTINCT session.id) <> 1
       OR count(history.id) <> 1
       OR min(history.code) IS DISTINCT FROM event.session_code
  ) AS invalid_pairing;

  IF invalid_event_codes <> 0
     OR invalid_history_codes <> 0
     OR active_or_scheduled_events <> 0
     OR pairing_violations <> 0
     OR legacy_code_count > 1000000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'session_code_legacy_locked_recheck',
      MESSAGE = 'Session-code state changed between preflight and locked remediation',
      DETAIL = format(
        'invalid events: %s; invalid history: %s; active or scheduled: %s; pairing violations: %s; unique legacy codes: %s',
        invalid_event_codes,
        invalid_history_codes,
        active_or_scheduled_events,
        pairing_violations,
        legacy_code_count
      );
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TEMP TABLE session_code_legacy_mapping (
  legacy_code text PRIMARY KEY,
  strict_code text NOT NULL UNIQUE,
  CONSTRAINT session_code_legacy_mapping_strict_code_check
    CHECK (
      length(strict_code) = 6
      AND octet_length(translate(strict_code, '0123456789', '')) = 0
    )
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO session_code_legacy_mapping (legacy_code, strict_code)
SELECT code,
       lpad((row_number() OVER (ORDER BY code COLLATE "C") - 1)::text, 6, '0')
FROM public.event_session_codes
ORDER BY code COLLATE "C";
--> statement-breakpoint
UPDATE public.event_session_codes AS history
SET legacy_code = history.code,
    code = mapping.strict_code
FROM session_code_legacy_mapping AS mapping
WHERE mapping.legacy_code = history.code;
--> statement-breakpoint
UPDATE public.events AS event
SET session_code = mapping.strict_code
FROM session_code_legacy_mapping AS mapping
WHERE mapping.legacy_code = event.session_code;
--> statement-breakpoint
ALTER TABLE "public"."events"
  ALTER COLUMN "session_code" SET DEFAULT lpad(
    (mod(
      (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint),
      1000000
    ))::text,
    6,
    '0'
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "event_session_codes_legacy_code_idx"
ON "public"."event_session_codes" USING btree ("legacy_code")
WHERE "legacy_code" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."event_session_codes"
  ADD CONSTRAINT "event_session_codes_code_format_check"
  CHECK (length("code") = 6 AND octet_length(translate("code", '0123456789', '')) = 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_session_code_format_check"
  CHECK (length("session_code") = 6 AND octet_length(translate("session_code", '0123456789', '')) = 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "public"."event_session_codes"
  ADD CONSTRAINT "event_session_codes_legacy_code_format_check"
  CHECK (
    "legacy_code" IS NULL
    OR (
      length("legacy_code") = 8
      AND octet_length(translate("legacy_code", '0123456789', '')) = 0
    )
  ) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE
  events_default text;
  invalid_event_codes bigint;
  invalid_history_codes bigint;
  invalid_legacy_codes bigint;
  pairing_violations bigint;
  history_count bigint;
  strict_code_count bigint;
  legacy_code_count bigint;
BEGIN
  SELECT column_default
  INTO events_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'events'
    AND column_name = 'session_code';

  SELECT count(*) INTO invalid_event_codes
  FROM public.events
  WHERE session_code IS NULL
     OR length(session_code) <> 6
     OR octet_length(translate(session_code, '0123456789', '')) <> 0;

  SELECT count(*), count(DISTINCT code), count(DISTINCT legacy_code)
  INTO history_count, strict_code_count, legacy_code_count
  FROM public.event_session_codes;

  SELECT count(*) INTO invalid_history_codes
  FROM public.event_session_codes
  WHERE code IS NULL
     OR length(code) <> 6
     OR octet_length(translate(code, '0123456789', '')) <> 0;

  SELECT count(*) INTO invalid_legacy_codes
  FROM public.event_session_codes
  WHERE legacy_code IS NULL
     OR length(legacy_code) <> 8
     OR octet_length(translate(legacy_code, '0123456789', '')) <> 0;

  SELECT count(*) INTO pairing_violations
  FROM (
    SELECT event.id
    FROM public.events AS event
    LEFT JOIN public.event_sessions AS session
      ON session.event_id = event.id
    LEFT JOIN public.event_session_codes AS history
      ON history.session_id = session.id
     AND history.valid_until IS NULL
     AND history.revoked_at IS NULL
    GROUP BY event.id, event.session_code
    HAVING count(DISTINCT session.id) <> 1
       OR count(history.id) <> 1
       OR min(history.code) IS DISTINCT FROM event.session_code
  ) AS invalid_pairing;

  IF events_default IS NULL
     OR events_default NOT LIKE '%1000000%'
     OR events_default NOT LIKE '%6, ''0''%'
     OR invalid_event_codes <> 0
     OR invalid_history_codes <> 0
     OR invalid_legacy_codes <> 0
     OR pairing_violations <> 0
     OR history_count <> strict_code_count
     OR history_count <> legacy_code_count
     OR NOT EXISTS (
       SELECT 1
       FROM pg_index AS index_metadata
       JOIN pg_class AS index_relation
         ON index_relation.oid = index_metadata.indexrelid
       JOIN pg_namespace AS index_schema
         ON index_schema.oid = index_relation.relnamespace
       WHERE index_schema.nspname = 'public'
         AND index_relation.relname = 'event_session_codes_legacy_code_idx'
         AND index_metadata.indrelid = 'public.event_session_codes'::regclass
         AND index_metadata.indisunique
         AND index_metadata.indisvalid
         AND index_metadata.indisready
         AND pg_get_expr(index_metadata.indpred, index_metadata.indrelid) = '(legacy_code IS NOT NULL)'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint AS constraint_metadata
       WHERE constraint_metadata.conrelid = 'public.events'::regclass
         AND constraint_metadata.conname = 'events_session_code_format_check'
         AND constraint_metadata.contype = 'c'
         AND NOT constraint_metadata.convalidated
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%octet_length%'
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%0123456789%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint AS constraint_metadata
       WHERE constraint_metadata.conrelid = 'public.event_session_codes'::regclass
         AND constraint_metadata.conname = 'event_session_codes_code_format_check'
         AND constraint_metadata.contype = 'c'
         AND NOT constraint_metadata.convalidated
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%octet_length%'
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%0123456789%'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_constraint AS constraint_metadata
       WHERE constraint_metadata.conrelid = 'public.event_session_codes'::regclass
         AND constraint_metadata.conname = 'event_session_codes_legacy_code_format_check'
         AND constraint_metadata.contype = 'c'
         AND NOT constraint_metadata.convalidated
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%legacy_code IS NULL%'
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%octet_length%'
         AND pg_get_constraintdef(constraint_metadata.oid) LIKE '%0123456789%'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'session_code_6_digits_metadata_verification',
      MESSAGE = 'The strict six-digit remediation result could not be verified',
      DETAIL = format(
        'invalid events: %s; invalid history: %s; invalid legacy audit rows: %s; pairing violations: %s; history rows: %s; unique strict codes: %s; unique legacy codes: %s',
        invalid_event_codes,
        invalid_history_codes,
        invalid_legacy_codes,
        pairing_violations,
        history_count,
        strict_code_count,
        legacy_code_count
      );
  END IF;
END;
$$;
