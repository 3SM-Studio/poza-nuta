CREATE TABLE "event_participants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_participants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_session_id" bigint NOT NULL,
	"participant_id" bigint NOT NULL,
	"display_name" text NOT NULL,
	"normalized_display_name" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_participants_display_name_check" CHECK (char_length("event_participants"."display_name") between 2 and 24
        and "event_participants"."display_name" = regexp_replace(btrim("event_participants"."display_name"), '[[:space:]]+', ' ', 'g')),
	CONSTRAINT "event_participants_normalized_display_name_check" CHECK ("event_participants"."normalized_display_name" = lower("event_participants"."display_name"))
);
--> statement-breakpoint
ALTER TABLE "event_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "participant_credentials" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "participant_credentials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"participant_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_credentials_token_hash_format_check" CHECK ("participant_credentials"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "participant_credentials_time_order_check" CHECK ("participant_credentials"."expires_at" > "participant_credentials"."created_at"
        and "participant_credentials"."last_used_at" >= "participant_credentials"."created_at"
        and ("participant_credentials"."revoked_at" is null or "participant_credentials"."revoked_at" >= "participant_credentials"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "participant_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "participant_identities" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "participant_identities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participant_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "song_requests" ADD COLUMN "event_participant_id" bigint;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_session_id_event_sessions_id_fk" FOREIGN KEY ("event_session_id") REFERENCES "public"."event_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_participant_id_participant_identities_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_credentials" ADD CONSTRAINT "participant_credentials_participant_id_participant_identities_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_participants_session_participant_idx" ON "event_participants" USING btree ("event_session_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_participants_session_nickname_idx" ON "event_participants" USING btree ("event_session_id","normalized_display_name");--> statement-breakpoint
CREATE INDEX "event_participants_participant_idx" ON "event_participants" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_credentials_token_hash_idx" ON "participant_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "participant_credentials_participant_idx" ON "participant_credentials" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "participant_credentials_expires_at_idx" ON "participant_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_identities_public_id_idx" ON "participant_identities" USING btree ("public_id");--> statement-breakpoint
ALTER TABLE "song_requests" ADD CONSTRAINT "song_requests_event_participant_id_event_participants_id_fk" FOREIGN KEY ("event_participant_id") REFERENCES "public"."event_participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "song_requests_event_participant_idx" ON "song_requests" USING btree ("event_participant_id");