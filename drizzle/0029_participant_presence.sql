SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE TABLE "participant_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_participant_id" bigint NOT NULL,
	"credential_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "participant_connections_time_check" CHECK ("participant_connections"."expires_at" >= "participant_connections"."heartbeat_at" and "participant_connections"."heartbeat_at" >= "participant_connections"."created_at")
);
--> statement-breakpoint
ALTER TABLE "participant_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "participant_connections" ADD CONSTRAINT "participant_connections_member_fk" FOREIGN KEY ("event_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_connections" ADD CONSTRAINT "participant_connections_credential_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."participant_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participant_connections_member_expiry_idx" ON "participant_connections" USING btree ("event_participant_id","expires_at");--> statement-breakpoint
CREATE INDEX "participant_connections_credential_created_idx" ON "participant_connections" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "participant_connections_expiry_idx" ON "participant_connections" USING btree ("expires_at");
--> statement-breakpoint
REVOKE ALL ON TABLE public.participant_connections FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION private.broadcast_presence_credential_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE changed_event_id bigint;
BEGIN
  IF TG_OP = 'DELETE' OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    FOR changed_event_id IN
      SELECT DISTINCT es.event_id FROM public.event_participants ep
      JOIN public.event_sessions es ON es.id = ep.event_session_id
      WHERE ep.participant_id = COALESCE(NEW.participant_id, OLD.participant_id)
    LOOP
      PERFORM realtime.send(jsonb_build_object('eventId', changed_event_id, 'type', 'participants_changed',
        'operation', 'UPDATE', 'changedAt', clock_timestamp()), 'participants_changed',
        'dashboard:event:' || changed_event_id::text || ':participants', true);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.broadcast_presence_credential_changed() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER participant_credential_presence_changed AFTER UPDATE OF revoked_at, expires_at OR DELETE
ON public.participant_credentials FOR EACH ROW EXECUTE FUNCTION private.broadcast_presence_credential_changed();
