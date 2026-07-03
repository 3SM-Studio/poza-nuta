CREATE TYPE "public"."platform_member_role" AS ENUM('platform_owner', 'platform_admin', 'support');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_role" AS ENUM('owner', 'manager', 'operator', 'viewer');--> statement-breakpoint
CREATE TABLE "platform_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operator_user_id" bigint NOT NULL,
	"role" "platform_member_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" bigint NOT NULL,
	"operator_user_id" bigint NOT NULL,
	"role" "workspace_member_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspaces_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_handle_format_check" CHECK ("workspaces"."handle" ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$')
);
--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "workspaces" ("name", "handle") VALUES ('Poza Nutą', 'pozanuta');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "workspace_id" bigint;--> statement-breakpoint
UPDATE "events"
SET "workspace_id" = (
	SELECT "id"
	FROM "workspaces"
	WHERE "handle" = 'pozanuta'
	LIMIT 1
)
WHERE "workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "events_one_active_public_idx";--> statement-breakpoint
ALTER TABLE "platform_members" ADD CONSTRAINT "platform_members_operator_user_id_operator_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."operator_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_operator_user_id_operator_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."operator_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_members_operator_idx" ON "platform_members" USING btree ("operator_user_id");--> statement-breakpoint
CREATE INDEX "platform_members_role_idx" ON "platform_members" USING btree ("role");--> statement-breakpoint
CREATE INDEX "platform_members_active_idx" ON "platform_members" USING btree ("active") WHERE "platform_members"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_operator_idx" ON "workspace_members" USING btree ("workspace_id","operator_user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_operator_idx" ON "workspace_members" USING btree ("operator_user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_workspace_role_idx" ON "workspace_members" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE INDEX "workspace_members_active_idx" ON "workspace_members" USING btree ("active") WHERE "workspace_members"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_handle_idx" ON "workspaces" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "workspaces_active_idx" ON "workspaces" USING btree ("active") WHERE "workspaces"."active" = true;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_one_active_public_per_workspace_idx" ON "events" USING btree ("workspace_id") WHERE "events"."is_active_public_event" = true;--> statement-breakpoint
CREATE INDEX "events_workspace_status_starts_at_idx" ON "events" USING btree ("workspace_id","status","starts_at" DESC NULLS LAST);
