SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'public_event_session_identity_preflight',
      MESSAGE = 'PostgreSQL 15 or newer is required';
  END IF;

  IF to_regclass('public.events') IS NULL
     OR to_regclass('public.event_access_links') IS NULL
     OR to_regclass('public.song_requests') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'public_event_session_identity_preflight',
      MESSAGE = 'Required event foundation tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_available_extensions
    WHERE name = 'pgcrypto'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'public_event_session_identity_preflight',
      MESSAGE = 'Required cryptographic extension is unavailable';
  END IF;

  IF to_regclass('public.event_sessions') IS NOT NULL
     OR to_regclass('public.event_session_codes') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'events'
         AND column_name IN ('public_id', 'close_reason')
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'public_event_session_identity_preflight',
      MESSAGE = 'Public event session identity objects already exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.events
    WHERE session_code IS NULL OR session_code !~ '^[0-9]{8}$'
  ) OR EXISTS (
    SELECT session_code
    FROM public.events
    GROUP BY session_code
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'public_event_session_identity_preflight',
      MESSAGE = 'Canonical event codes do not satisfy the 0020 contract';
  END IF;
END;
$$;
--> statement-breakpoint
LOCK TABLE "public"."events" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
LOCK TABLE "public"."event_access_links" IN SHARE MODE;
--> statement-breakpoint
LOCK TABLE "public"."song_requests" IN SHARE MODE;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
ALTER TABLE "public"."events" ADD COLUMN "public_id" uuid;
--> statement-breakpoint
ALTER TABLE "public"."events" ADD COLUMN "close_reason" text;
--> statement-breakpoint
CREATE TABLE "public"."event_sessions" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "event_id" bigint NOT NULL,
  "public_token" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_sessions_public_token_format_check"
    CHECK ("public_token" ~ '^[A-Za-z0-9_-]{22}$')
);
--> statement-breakpoint
ALTER TABLE "public"."event_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "public"."event_session_codes" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "session_id" bigint NOT NULL,
  "code" text NOT NULL,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_until" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "release_after" timestamp with time zone,
  "created_by_operator_id" bigint,
  "revoked_by_operator_id" bigint,
  "rotation_reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_session_codes_code_format_check"
    CHECK ("code" ~ '^[0-9]{8}$'),
  CONSTRAINT "event_session_codes_chronology_check"
    CHECK (
      ("revoked_at" IS NULL AND "valid_until" IS NULL)
      OR
      ("revoked_at" IS NOT NULL AND "valid_until" = "revoked_at" AND "revoked_at" >= "valid_from")
    ),
  CONSTRAINT "event_session_codes_revocation_check"
    CHECK (
      ("revoked_at" IS NULL AND "valid_until" IS NULL AND "release_after" IS NULL AND "revoked_by_operator_id" IS NULL)
      OR
      ("revoked_at" IS NOT NULL AND "valid_until" IS NOT NULL AND "release_after" IS NOT NULL AND "release_after" >= "revoked_at" + interval '365 days')
    ),
  CONSTRAINT "event_session_codes_rotation_reason_check"
    CHECK ("rotation_reason" IN ('migration', 'initial', 'operator_rotation'))
);
--> statement-breakpoint
ALTER TABLE "public"."event_session_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "public"."event_sessions"
FROM PUBLIC, "anon", "authenticated";
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "public"."event_session_codes"
FROM PUBLIC, "anon", "authenticated";
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SEQUENCE "public"."event_sessions_id_seq"
FROM PUBLIC, "anon", "authenticated";
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SEQUENCE "public"."event_session_codes_id_seq"
FROM PUBLIC, "anon", "authenticated";
--> statement-breakpoint
DO $$
DECLARE
  target_event record;
  candidate_public_id uuid;
  candidate_token text;
  assigned boolean;
  created_session_id bigint;
BEGIN
  FOR target_event IN
    SELECT id, session_code, created_at
    FROM public.events
    ORDER BY id
  LOOP
    assigned := false;

    FOR attempt IN 1..64 LOOP
      candidate_public_id := gen_random_uuid();
      candidate_token := rtrim(
        translate(encode(gen_random_bytes(16), 'base64'), '+/', '-_'),
        '='
      );

      IF NOT EXISTS (
        SELECT 1 FROM public.events WHERE public_id = candidate_public_id
      ) AND NOT EXISTS (
        SELECT 1 FROM public.event_sessions WHERE public_token = candidate_token
      ) THEN
        UPDATE public.events
        SET
          public_id = candidate_public_id,
          close_reason = CASE
            WHEN closed_at IS NULL THEN NULL
            WHEN auto_close_at IS NOT NULL AND closed_at >= auto_close_at THEN 'automatic'
            ELSE 'manual'
          END
        WHERE id = target_event.id;

        INSERT INTO public.event_sessions (event_id, public_token, created_at)
        VALUES (target_event.id, candidate_token, target_event.created_at)
        RETURNING id INTO created_session_id;

        INSERT INTO public.event_session_codes (
          session_id,
          code,
          valid_from,
          rotation_reason,
          created_at
        )
        VALUES (
          created_session_id,
          target_event.session_code,
          target_event.created_at,
          'migration',
          target_event.created_at
        );

        assigned := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT assigned THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'public_event_session_identity_generation',
        MESSAGE = 'Could not assign a unique event session identity';
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
ALTER TABLE "public"."events"
  ALTER COLUMN "public_id" SET NOT NULL,
  ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid();
--> statement-breakpoint
ALTER TABLE "public"."events"
  ADD CONSTRAINT "events_close_reason_check"
  CHECK (
    ("closed_at" IS NULL AND "close_reason" IS NULL)
    OR
    ("closed_at" IS NOT NULL AND "close_reason" IN ('manual', 'scheduled', 'automatic'))
  );
--> statement-breakpoint
ALTER TABLE "public"."event_sessions"
  ADD CONSTRAINT "event_sessions_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "public"."event_session_codes"
  ADD CONSTRAINT "event_session_codes_session_id_event_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."event_sessions"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "public"."event_session_codes"
  ADD CONSTRAINT "event_session_codes_created_by_operator_id_operator_users_id_fk"
  FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operator_users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "public"."event_session_codes"
  ADD CONSTRAINT "event_session_codes_revoked_by_operator_id_operator_users_id_fk"
  FOREIGN KEY ("revoked_by_operator_id") REFERENCES "public"."operator_users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "events_public_id_idx"
ON "public"."events" USING btree ("public_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "event_sessions_event_id_idx"
ON "public"."event_sessions" USING btree ("event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "event_sessions_public_token_idx"
ON "public"."event_sessions" USING btree ("public_token");
--> statement-breakpoint
CREATE UNIQUE INDEX "event_session_codes_code_idx"
ON "public"."event_session_codes" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "event_session_codes_current_session_idx"
ON "public"."event_session_codes" USING btree ("session_id")
WHERE "valid_until" IS NULL AND "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "event_session_codes_session_created_at_idx"
ON "public"."event_session_codes" USING btree ("session_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "event_session_codes_release_after_idx"
ON "public"."event_session_codes" USING btree ("release_after")
WHERE "release_after" IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."broadcast_song_request_queue_changed"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed_event_id bigint;
  changed_at timestamp with time zone := statement_timestamp();
  changed_public_token text;
BEGIN
  changed_event_id := COALESCE(NEW."event_id", OLD."event_id");

  IF changed_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s."public_token"
  INTO changed_public_token
  FROM "public"."event_sessions" s
  WHERE s."event_id" = changed_event_id;

  PERFORM "realtime"."send"(
    jsonb_build_object(
      'eventId', changed_event_id,
      'type', 'queue_changed',
      'operation', TG_OP,
      'changedAt', changed_at
    ),
    'queue_changed',
    'dashboard:event:' || changed_event_id::text || ':queue',
    true
  );

  IF changed_public_token IS NOT NULL THEN
    PERFORM "realtime"."send"(
      jsonb_build_object('type', 'queue_changed', 'changedAt', changed_at),
      'queue_changed',
      'public:session:' || changed_public_token || ':queue',
      true
    );
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."broadcast_song_request_queue_changed"() FROM PUBLIC, "anon", "authenticated";
--> statement-breakpoint
DROP POLICY IF EXISTS "public clients can receive public queue broadcasts" ON "realtime"."messages";
--> statement-breakpoint
CREATE POLICY "public clients can receive public queue broadcasts"
ON "realtime"."messages"
AS PERMISSIVE
FOR SELECT
TO "anon", "authenticated"
USING (
  "realtime"."messages"."extension" = 'broadcast'
  AND (SELECT "realtime"."topic"()) ~ '^public:session:[A-Za-z0-9_-]{22}:queue$'
);
--> statement-breakpoint
DO $$
DECLARE
  event_count bigint;
  session_count bigint;
  code_count bigint;
  invalid_count bigint;
BEGIN
  SELECT count(*) INTO event_count FROM public.events;
  SELECT count(*) INTO session_count FROM public.event_sessions;
  SELECT count(*) INTO code_count FROM public.event_session_codes;

  SELECT count(*) INTO invalid_count
  FROM public.events e
  LEFT JOIN public.event_sessions s ON s.event_id = e.id
  LEFT JOIN public.event_session_codes c
    ON c.session_id = s.id
   AND c.valid_until IS NULL
   AND c.revoked_at IS NULL
  WHERE e.public_id IS NULL
     OR s.id IS NULL
     OR s.public_token !~ '^[A-Za-z0-9_-]{22}$'
     OR c.id IS NULL
     OR c.code <> e.session_code;

  IF event_count <> session_count
     OR event_count <> code_count
     OR invalid_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'public_event_session_identity_verification',
      MESSAGE = 'Public event session identity verification failed';
  END IF;
END;
$$;
