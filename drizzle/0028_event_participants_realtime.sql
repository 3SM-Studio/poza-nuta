-- Additive invalidation channel. No participant data is broadcast.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE FUNCTION "private"."can_receive_event_participants"(topic text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.workspaces w ON w.id = e.workspace_id AND w.active
    JOIN public.workspace_members m ON m.workspace_id = w.id AND m.active
    JOIN public.operator_users o ON o.id = m.operator_user_id AND o.active
    WHERE o.auth_user_id = (SELECT auth.uid()) AND o.suspended_at IS NULL
      AND topic = 'dashboard:event:' || e.id::text || ':participants'
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."can_receive_event_participants"(text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "private"."can_receive_event_participants"(text) TO authenticated;
--> statement-breakpoint
CREATE POLICY "event members can receive participant invalidations"
ON realtime.messages FOR SELECT TO authenticated
USING (extension = 'broadcast' AND private.can_receive_event_participants((SELECT realtime.topic())));
--> statement-breakpoint
CREATE FUNCTION "private"."broadcast_event_participants_changed"()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE changed_event_id bigint;
BEGIN
  SELECT event_id INTO changed_event_id FROM public.event_sessions
    WHERE id = COALESCE(NEW.event_session_id, OLD.event_session_id);
  IF changed_event_id IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('eventId', changed_event_id, 'type', 'participants_changed',
        'operation', TG_OP, 'changedAt', statement_timestamp()),
      'participants_changed', 'dashboard:event:' || changed_event_id::text || ':participants', true
    );
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."broadcast_event_participants_changed"() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER event_participants_broadcast_changed
AFTER INSERT OR UPDATE OR DELETE ON public.event_participants
FOR EACH ROW EXECUTE FUNCTION private.broadcast_event_participants_changed();
