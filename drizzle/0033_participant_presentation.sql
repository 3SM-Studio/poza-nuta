-- Expand only: record only actual future renames, never infer historical aliases.
CREATE FUNCTION private.participant_presentation_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event_key bigint; revision_value bigint; revision_key text; token text;
BEGIN
  SELECT event_id,public_token INTO event_key,token FROM public.event_sessions WHERE id=NEW.event_session_id;
  IF event_key IS NULL THEN RETURN NULL; END IF;
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    INSERT INTO public.operator_audit_log(actor_kind,operator_id,event_id,action,entity_id,payload)
      VALUES('system',NULL,event_key,'participant_nickname_changed',NEW.id::text,
        jsonb_build_object('before',OLD.display_name,'after',NEW.display_name));
  END IF;
  -- Share the existing per-event transaction marker with structural queue writes.
  -- Keep every actual rename audit, but publish only one canonical invalidation.
  revision_key := 'kunestu.queue_event_' || event_key::text;
  IF nullif(current_setting(revision_key,true),'') IS NOT NULL THEN RETURN NULL; END IF;
  -- Presentation revisions are monotonic snapshots, not semantic request versions.
  INSERT INTO public.queue_streams(event_id,revision) VALUES(event_key,1)
    ON CONFLICT(event_id) DO UPDATE SET revision=public.queue_streams.revision+1 RETURNING revision INTO revision_value;
  PERFORM set_config(revision_key,revision_value::text,true);
  PERFORM realtime.send(jsonb_build_object('eventId',event_key,'type','queue_changed','operation','UPDATE',
    'revision',revision_value::text,'changedAt',statement_timestamp()),'queue_changed','dashboard:event:'||event_key::text||':queue',true);
  IF token IS NOT NULL THEN PERFORM realtime.send(jsonb_build_object('type','queue_changed','changedAt',statement_timestamp()),
    'queue_changed','public:session:'||token||':queue',true); END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.participant_presentation_changed() FROM PUBLIC,anon,authenticated;
--> statement-breakpoint
CREATE TRIGGER participant_presentation_changed AFTER UPDATE OF display_name,merged_into_id ON public.event_participants
FOR EACH ROW WHEN (ROW(NEW.display_name,NEW.merged_into_id) IS DISTINCT FROM ROW(OLD.display_name,OLD.merged_into_id))
EXECUTE FUNCTION private.participant_presentation_changed();
