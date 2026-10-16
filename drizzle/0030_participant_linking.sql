SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE TABLE "participant_device_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_session_id" bigint NOT NULL,
	"participant_id" bigint NOT NULL,
	"issuer_credential_id" bigint,
	"token_hash" text NOT NULL,
	"challenge_hash" text,
	"verification_hash" text,
	"approval_attempts" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"issued_credential_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "participant_device_links_hash_check" CHECK ("participant_device_links"."token_hash" ~ '^[a-f0-9]{64}$' and ("participant_device_links"."challenge_hash" is null or "participant_device_links"."challenge_hash" ~ '^[a-f0-9]{64}$') and ("participant_device_links"."verification_hash" is null or "participant_device_links"."verification_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "participant_device_links_state_check" CHECK ("participant_device_links"."expires_at" > "participant_device_links"."created_at" and "participant_device_links"."expires_at" <= "participant_device_links"."created_at" + interval '5 minutes' and "participant_device_links"."approval_attempts" between 0 and 5 and ("participant_device_links"."challenge_hash" is null) = ("participant_device_links"."verification_hash" is null) and ("participant_device_links"."approved_at" is null or "participant_device_links"."challenge_hash" is not null) and ("participant_device_links"."consumed_at" is null or ("participant_device_links"."approved_at" is not null and "participant_device_links"."issued_credential_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "participant_device_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "participant_merge_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_session_id" bigint NOT NULL,
	"source_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"target_updated_at" timestamp with time zone NOT NULL,
	"source_consent_required" boolean NOT NULL,
	"source_consent_credential_id" bigint,
	"target_consent_credential_id" bigint,
	"source_consented_at" timestamp with time zone,
	"target_consented_at" timestamp with time zone,
	"created_by_operator_id" bigint,
	"completed_by_operator_id" bigint,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "participant_merge_proposals_state_check" CHECK ("participant_merge_proposals"."source_id" <> "participant_merge_proposals"."target_id" and "participant_merge_proposals"."expires_at" > "participant_merge_proposals"."created_at" and "participant_merge_proposals"."expires_at" <= "participant_merge_proposals"."created_at" + interval '5 minutes' and ("participant_merge_proposals"."source_consented_at" is null) = ("participant_merge_proposals"."source_consent_credential_id" is null) and ("participant_merge_proposals"."target_consented_at" is null) = ("participant_merge_proposals"."target_consent_credential_id" is null) and not ("participant_merge_proposals"."cancelled_at" is not null and "participant_merge_proposals"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "participant_merge_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "merged_into_id" bigint;--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participant_device_links" ADD CONSTRAINT "participant_device_links_event_session_id_event_sessions_id_fk" FOREIGN KEY ("event_session_id") REFERENCES "public"."event_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_device_links" ADD CONSTRAINT "participant_device_links_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_device_links" ADD CONSTRAINT "participant_device_links_issuer_credential_id_fk" FOREIGN KEY ("issuer_credential_id") REFERENCES "public"."participant_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_device_links" ADD CONSTRAINT "participant_device_links_issued_credential_id_fk" FOREIGN KEY ("issued_credential_id") REFERENCES "public"."participant_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_merge_proposals" ADD CONSTRAINT "participant_merge_proposals_session_fk" FOREIGN KEY ("event_session_id") REFERENCES "public"."event_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_merge_proposals" ADD CONSTRAINT "participant_merge_proposals_source_id_event_participants_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_merge_proposals" ADD CONSTRAINT "participant_merge_proposals_target_id_event_participants_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_merge_proposals" ADD CONSTRAINT "participant_merge_proposals_source_consent_credential_id_fk" FOREIGN KEY ("source_consent_credential_id") REFERENCES "public"."participant_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_merge_proposals" ADD CONSTRAINT "participant_merge_proposals_target_consent_credential_id_fk" FOREIGN KEY ("target_consent_credential_id") REFERENCES "public"."participant_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_merge_proposals" ADD CONSTRAINT "participant_merge_proposals_created_by_operator_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operator_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_merge_proposals" ADD CONSTRAINT "participant_merge_proposals_completed_by_operator_id_fk" FOREIGN KEY ("completed_by_operator_id") REFERENCES "public"."operator_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_device_links_token_idx" ON "participant_device_links" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_device_links_challenge_idx" ON "participant_device_links" USING btree ("challenge_hash");--> statement-breakpoint
CREATE INDEX "participant_device_links_issuer_created_idx" ON "participant_device_links" USING btree ("issuer_credential_id","created_at");--> statement-breakpoint
CREATE INDEX "participant_device_links_participant_created_idx" ON "participant_device_links" USING btree ("participant_id","created_at");--> statement-breakpoint
CREATE INDEX "participant_device_links_expiry_idx" ON "participant_device_links" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "participant_merge_proposals_source_idx" ON "participant_merge_proposals" USING btree ("source_id","expires_at");--> statement-breakpoint
CREATE INDEX "participant_merge_proposals_target_idx" ON "participant_merge_proposals" USING btree ("target_id","expires_at");--> statement-breakpoint
CREATE INDEX "participant_merge_proposals_event_idx" ON "participant_merge_proposals" USING btree ("event_session_id","created_at");--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_merged_into_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."event_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_participants_merged_into_idx" ON "event_participants" USING btree ("merged_into_id");--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_merge_state_check" CHECK (("event_participants"."merged_into_id" is null and "event_participants"."merged_at" is null) or ("event_participants"."merged_into_id" is not null and "event_participants"."merged_into_id" <> "event_participants"."id" and "event_participants"."merged_at" is not null));
--> statement-breakpoint
REVOKE ALL ON TABLE public.participant_device_links, public.participant_merge_proposals FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION private.enforce_participant_merge_alias()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE target_session bigint; target_merge bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('participant-alias:' || NEW.event_session_id::text, 0));
  IF TG_OP = 'UPDATE' AND NEW.event_session_id <> OLD.event_session_id AND EXISTS (
    SELECT 1 FROM public.event_participants WHERE merged_into_id = NEW.id
  ) THEN RAISE EXCEPTION 'Cannot move a canonical participant with aliases' USING ERRCODE = '23514'; END IF;
  IF NEW.merged_into_id IS NOT NULL THEN
    SELECT event_session_id, merged_into_id INTO target_session, target_merge
      FROM public.event_participants WHERE id = NEW.merged_into_id FOR SHARE;
    IF target_session IS DISTINCT FROM NEW.event_session_id OR target_merge IS NOT NULL
      OR NEW.id = NEW.merged_into_id OR EXISTS (
        SELECT 1 FROM public.event_participants WHERE merged_into_id = NEW.id
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'event_participant_alias_scope',
        MESSAGE = 'Participant aliases must point directly to a canonical participant in the same event';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.merged_into_id IS NOT NULL AND NEW.merged_into_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'event_participant_alias_immutable',
      MESSAGE = 'A merged participant cannot be silently restored';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.enforce_participant_merge_alias() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER event_participant_merge_alias_guard BEFORE INSERT OR UPDATE OF merged_into_id, event_session_id
ON public.event_participants FOR EACH ROW EXECUTE FUNCTION private.enforce_participant_merge_alias();
--> statement-breakpoint
CREATE FUNCTION private.enforce_participant_proposal_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (SELECT count(*) FROM public.event_participants WHERE id IN (NEW.source_id, NEW.target_id)
    AND event_session_id = NEW.event_session_id) <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'participant_proposal_event_scope',
      MESSAGE = 'A proposal must contain two participants from the same event';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.enforce_participant_proposal_scope() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER participant_merge_proposal_scope_guard BEFORE INSERT OR UPDATE OF source_id, target_id, event_session_id
ON public.participant_merge_proposals FOR EACH ROW EXECUTE FUNCTION private.enforce_participant_proposal_scope();
