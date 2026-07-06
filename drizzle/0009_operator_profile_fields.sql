ALTER TABLE "operator_users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "operator_users" ADD COLUMN "profile_completed_at" timestamp with time zone;
