CREATE SCHEMA IF NOT EXISTS "private";
--> statement-breakpoint
REVOKE ALL ON SCHEMA "private" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "private" TO "authenticated";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "private"."is_active_dashboard_operator"()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "public"."operator_users"
    WHERE "operator_users"."auth_user_id" = (SELECT "auth"."uid"())
      AND "operator_users"."active" = true
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."is_active_dashboard_operator"() FROM PUBLIC, "anon";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."is_active_dashboard_operator"() TO "authenticated";
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

  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."broadcast_song_request_queue_changed"() FROM PUBLIC, "anon", "authenticated";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "song_requests_broadcast_queue_changed_trigger" ON "public"."song_requests";
--> statement-breakpoint
CREATE TRIGGER "song_requests_broadcast_queue_changed_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "public"."song_requests"
FOR EACH ROW
EXECUTE FUNCTION "public"."broadcast_song_request_queue_changed"();
--> statement-breakpoint
DROP POLICY IF EXISTS "active operators can receive dashboard queue broadcasts" ON "realtime"."messages";
--> statement-breakpoint
CREATE POLICY "active operators can receive dashboard queue broadcasts"
ON "realtime"."messages"
AS PERMISSIVE
FOR SELECT
TO "authenticated"
USING (
  "realtime"."messages"."extension" = 'broadcast'
  AND (SELECT "realtime"."topic"()) ~ '^dashboard:event:[0-9]+:queue$'
  AND (SELECT "private"."is_active_dashboard_operator"())
);
