CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('ising', 'karafun');--> statement-breakpoint
CREATE TYPE "public"."song_request_source" AS ENUM('public', 'operator');--> statement-breakpoint
CREATE TYPE "public"."song_request_status" AS ENUM('pending', 'approved', 'now', 'done', 'skipped', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."song_source" AS ENUM('ising', 'karafun', 'manual');--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"venue" text,
	"starts_at" timestamp with time zone NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"is_active_public_event" boolean DEFAULT false NOT NULL,
	"public_queue_enabled" boolean DEFAULT false NOT NULL,
	"public_show_song_titles" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_active_public_status_check" CHECK (not "events"."is_active_public_event" or "events"."status" = 'active')
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" "import_source" NOT NULL,
	"status" "import_job_status" DEFAULT 'pending' NOT NULL,
	"started_by_operator_id" bigint,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_jobs_counts_check" CHECK ("import_jobs"."total_rows" >= 0 and "import_jobs"."imported_count" >= 0 and "import_jobs"."skipped_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operator_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operator_id" bigint,
	"event_id" bigint,
	"action" text NOT NULL,
	"entity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operator_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operator_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operator_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "song_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "song_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" bigint NOT NULL,
	"song_id" bigint NOT NULL,
	"singer_name" text NOT NULL,
	"display_name" text NOT NULL,
	"note" text,
	"status" "song_request_status" DEFAULT 'pending' NOT NULL,
	"position" integer NOT NULL,
	"requested_by" "song_request_source" NOT NULL,
	"created_by_operator_id" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "song_requests_position_check" CHECK ("song_requests"."position" >= 0),
	CONSTRAINT "song_requests_version_check" CHECK ("song_requests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "song_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "songs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "songs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" "song_source" NOT NULL,
	"source_song_id" text,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"normalized_title" text NOT NULL,
	"normalized_artist" text NOT NULL,
	"search_text" text NOT NULL,
	"duration_seconds" integer,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_duet" boolean DEFAULT false NOT NULL,
	"is_explicit" boolean DEFAULT false NOT NULL,
	"is_plus" boolean DEFAULT false NOT NULL,
	"is_hit" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"last_seen_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "songs_duration_seconds_check" CHECK ("songs"."duration_seconds" is null or "songs"."duration_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "songs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_started_by_operator_id_operator_users_id_fk" FOREIGN KEY ("started_by_operator_id") REFERENCES "public"."operator_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_log" ADD CONSTRAINT "operator_audit_log_operator_id_operator_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operator_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_log" ADD CONSTRAINT "operator_audit_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_sessions" ADD CONSTRAINT "operator_sessions_operator_id_operator_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operator_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_requests" ADD CONSTRAINT "song_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_requests" ADD CONSTRAINT "song_requests_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "song_requests" ADD CONSTRAINT "song_requests_created_by_operator_id_operator_users_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operator_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_one_active_public_idx" ON "events" USING btree ("is_active_public_event") WHERE "events"."is_active_public_event" = true;--> statement-breakpoint
CREATE INDEX "events_status_starts_at_idx" ON "events" USING btree ("status","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_jobs_source_status_created_at_idx" ON "import_jobs" USING btree ("source","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "import_jobs_started_by_operator_idx" ON "import_jobs" USING btree ("started_by_operator_id");--> statement-breakpoint
CREATE INDEX "operator_audit_log_event_created_at_idx" ON "operator_audit_log" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operator_audit_log_operator_created_at_idx" ON "operator_audit_log" USING btree ("operator_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operator_audit_log_action_created_at_idx" ON "operator_audit_log" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "operator_sessions_token_hash_idx" ON "operator_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "operator_sessions_operator_expires_at_idx" ON "operator_sessions" USING btree ("operator_id","expires_at");--> statement-breakpoint
CREATE INDEX "operator_sessions_expires_at_idx" ON "operator_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_users_name_idx" ON "operator_users" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "operator_users_active_idx" ON "operator_users" USING btree ("active") WHERE "operator_users"."active" = true;--> statement-breakpoint
CREATE INDEX "song_requests_event_queue_idx" ON "song_requests" USING btree ("event_id","status","position","id");--> statement-breakpoint
CREATE INDEX "song_requests_event_created_at_idx" ON "song_requests" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "song_requests_song_id_idx" ON "song_requests" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "song_requests_created_by_operator_idx" ON "song_requests" USING btree ("created_by_operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "songs_source_song_id_idx" ON "songs" USING btree ("source","source_song_id") WHERE "songs"."source_song_id" is not null;--> statement-breakpoint
CREATE INDEX "songs_search_text_trgm_idx" ON "songs" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "songs_normalized_title_artist_idx" ON "songs" USING btree ("normalized_title","normalized_artist");--> statement-breakpoint
CREATE INDEX "songs_normalized_artist_idx" ON "songs" USING btree ("normalized_artist");
