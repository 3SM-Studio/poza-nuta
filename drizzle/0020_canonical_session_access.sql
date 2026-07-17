DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'canonical_session_access_preflight',
      MESSAGE = 'PostgreSQL 15 or newer is required';
  END IF;

  IF to_regclass('public.events') IS NULL
     OR to_regclass('public.event_access_links') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'canonical_session_access_preflight',
      MESSAGE = 'Required event tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'session_code'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'canonical_session_access_preflight',
      MESSAGE = 'events.session_code already exists';
  END IF;
END;
$$;
--> statement-breakpoint
LOCK TABLE "public"."events" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE "public"."event_access_links" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
ALTER TABLE "public"."events" ADD COLUMN "session_code" text;
--> statement-breakpoint
DO $$
DECLARE
  target_event record;
  candidate text;
  assigned boolean;
BEGIN
  FOR target_event IN SELECT id FROM public.events ORDER BY id LOOP
    assigned := false;

    FOR attempt IN 1..64 LOOP
      candidate := lpad(
        mod(
          (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint),
          100000000
        )::text,
        8,
        '0'
      );

      IF NOT EXISTS (
        SELECT 1 FROM public.events WHERE session_code = candidate
      ) THEN
        UPDATE public.events
        SET session_code = candidate
        WHERE id = target_event.id;
        assigned := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT assigned THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'events_session_code_generation',
        MESSAGE = 'Could not assign a unique canonical session code';
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
UPDATE "public"."event_access_links"
SET
  "active" = false,
  "revoked_at" = COALESCE("revoked_at", clock_timestamp())
WHERE "active" = true OR "revoked_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "public"."events"
  ALTER COLUMN "session_code" SET NOT NULL,
  ALTER COLUMN "session_code" SET DEFAULT lpad(
    mod(
      (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint),
      100000000
    )::text,
    8,
    '0'
  );
--> statement-breakpoint
ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_session_code_format_check"
  CHECK ("session_code" ~ '^[0-9]{8}$');
--> statement-breakpoint
CREATE UNIQUE INDEX "events_session_code_idx"
ON "public"."events" USING btree ("session_code");
--> statement-breakpoint
DO $$
DECLARE
  event_count bigint;
  code_count bigint;
  invalid_code_count bigint;
  active_legacy_link_count bigint;
BEGIN
  SELECT count(*), count(DISTINCT session_code)
  INTO event_count, code_count
  FROM public.events;

  SELECT count(*)
  INTO invalid_code_count
  FROM public.events
  WHERE session_code IS NULL OR session_code !~ '^[0-9]{8}$';

  SELECT count(*)
  INTO active_legacy_link_count
  FROM public.event_access_links
  WHERE active = true OR revoked_at IS NULL;

  IF event_count <> code_count
     OR invalid_code_count <> 0
     OR active_legacy_link_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'canonical_session_access_verification',
      MESSAGE = 'Canonical session access verification failed';
  END IF;
END;
$$;
