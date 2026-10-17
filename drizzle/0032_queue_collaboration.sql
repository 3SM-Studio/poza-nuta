CREATE TABLE "queue_operation_receipts" (
	"event_id" bigint NOT NULL,
	"operation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"operator_id" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"request_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_operation_receipts_event_id_operation_id_pk" PRIMARY KEY("event_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "queue_operation_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "queue_streams" (
	"event_id" bigint PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queue_streams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "song_requests" ADD COLUMN "intent_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_operation_receipts" ADD CONSTRAINT "queue_operation_receipts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_operation_receipts" ADD CONSTRAINT "queue_operation_receipts_operator_id_operator_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operator_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_streams" ADD CONSTRAINT "queue_streams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_operation_receipts_actor_idx" ON "queue_operation_receipts" USING btree ("event_id","operator_id","device_id");
--> statement-breakpoint
REVOKE ALL ON TABLE public.queue_streams, public.queue_operation_receipts FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.bump_queue_intent_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.intent_version IS DISTINCT FROM OLD.intent_version THEN
    NEW.intent_version := OLD.intent_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.bump_queue_intent_version() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER song_requests_intent_version BEFORE UPDATE ON public.song_requests
FOR EACH ROW EXECUTE FUNCTION private.bump_queue_intent_version();
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
  revision_value bigint;
  revision_key text;
BEGIN
  changed_event_id := COALESCE(NEW."event_id", OLD."event_id");

  IF changed_event_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.events WHERE id=changed_event_id) THEN
    RETURN NULL;
  END IF;

  -- One stream revision and one broadcast per event/transaction, visible only after commit.
  -- Store the coalescing marker transaction-locally, never on the events lifecycle row.
  revision_key := 'kunestu.queue_event_' || changed_event_id::text;
  IF nullif(current_setting(revision_key, true), '') IS NOT NULL THEN RETURN NULL; END IF;
  INSERT INTO public.queue_streams(event_id, revision) VALUES (changed_event_id, 1)
    ON CONFLICT (event_id) DO UPDATE SET revision = public.queue_streams.revision + 1
    RETURNING revision INTO revision_value;
  PERFORM set_config(revision_key, revision_value::text, true);

  SELECT s."public_token"
  INTO changed_public_token
  FROM "public"."event_sessions" s
  WHERE s."event_id" = changed_event_id;

  PERFORM "realtime"."send"(
    jsonb_build_object(
      'revision', revision_value::text,
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
REVOKE ALL ON FUNCTION public.broadcast_song_request_queue_changed() FROM PUBLIC, anon, authenticated;

--> statement-breakpoint
-- A no-op Fair Sort and lifecycle edits also change the synchronisation context.
CREATE FUNCTION private.broadcast_queue_metadata_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event_key bigint; revision_key text; revision_value bigint;
BEGIN
  IF TG_TABLE_NAME = 'events' THEN event_key := NEW.id; ELSE event_key := NEW.event_id; END IF;
  IF event_key IS NULL THEN RETURN NULL; END IF;
  revision_key := 'kunestu.queue_event_' || event_key::text;
  IF nullif(current_setting(revision_key,true),'') IS NOT NULL THEN RETURN NULL; END IF;
  INSERT INTO public.queue_streams(event_id,revision) VALUES(event_key,1)
    ON CONFLICT(event_id) DO UPDATE SET revision=public.queue_streams.revision+1
    RETURNING revision INTO revision_value;
  PERFORM set_config(revision_key,revision_value::text,true);
  PERFORM realtime.send(jsonb_build_object('eventId',event_key,'type','queue_changed','operation','UPDATE',
    'revision',revision_value::text,'changedAt',statement_timestamp()),'queue_changed','dashboard:event:'||event_key::text||':queue',true);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.broadcast_queue_metadata_changed() FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
CREATE TRIGGER event_queue_sort_revision AFTER INSERT ON public.operator_audit_log
FOR EACH ROW WHEN (NEW.action = 'event_queue_fair_sort') EXECUTE FUNCTION private.broadcast_queue_metadata_changed();
--> statement-breakpoint
CREATE TRIGGER event_queue_lifecycle_revision AFTER UPDATE OF status,starts_at,auto_close_at,ends_at,closed_at,public_queue_enabled,song_requests_enabled ON public.events
FOR EACH ROW WHEN (ROW(OLD.status,OLD.starts_at,OLD.auto_close_at,OLD.ends_at,OLD.closed_at,OLD.public_queue_enabled,OLD.song_requests_enabled)
  IS DISTINCT FROM ROW(NEW.status,NEW.starts_at,NEW.auto_close_at,NEW.ends_at,NEW.closed_at,NEW.public_queue_enabled,NEW.song_requests_enabled))
EXECUTE FUNCTION private.broadcast_queue_metadata_changed();
