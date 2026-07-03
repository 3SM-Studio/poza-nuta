CREATE TABLE "event_access_links" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_access_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_id" bigint NOT NULL,
	"code_hash" text NOT NULL,
	"label" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by_operator_id" bigint,
	CONSTRAINT "event_access_links_use_count_check" CHECK ("event_access_links"."use_count" >= 0),
	CONSTRAINT "event_access_links_revoked_inactive_check" CHECK ("event_access_links"."revoked_at" is null or not "event_access_links"."active")
);
--> statement-breakpoint
ALTER TABLE "event_access_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_access_links" ADD CONSTRAINT "event_access_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_access_links" ADD CONSTRAINT "event_access_links_created_by_operator_id_operator_users_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operator_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_access_links_code_hash_idx" ON "event_access_links" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "event_access_links_event_created_at_idx" ON "event_access_links" USING btree ("event_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_access_links_created_by_operator_idx" ON "event_access_links" USING btree ("created_by_operator_id");