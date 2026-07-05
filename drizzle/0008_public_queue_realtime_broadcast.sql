CREATE OR REPLACE FUNCTION "public"."broadcast_song_request_queue_changed"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed_event_id bigint;
  changed_at timestamp with time zone := statement_timestamp();
BEGIN
  changed_event_id := COALESCE(NEW."event_id", OLD."event_id");

  IF changed_event_id IS NULL THEN
    RETURN NULL;
  END IF;

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

  PERFORM "realtime"."send"(
    jsonb_build_object(
      'type', 'queue_changed',
      'changedAt', changed_at
    ),
    'queue_changed',
    'public:event:' || changed_event_id::text || ':queue',
    true
  );

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
  AND (SELECT "realtime"."topic"()) ~ '^public:event:[0-9]+:queue$'
);
