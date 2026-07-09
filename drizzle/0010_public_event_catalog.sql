CREATE TYPE "public"."event_visibility" AS ENUM('private', 'public');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "visibility" "event_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_slug_format_check" CHECK ("events"."slug" is null or (char_length("events"."slug") between 3 and 80 and "events"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_public_requires_slug_and_published_at_check" CHECK ("events"."visibility" <> 'public' or ("events"."slug" is not null and "events"."published_at" is not null));--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_idx" ON "events" USING btree ("slug") WHERE "events"."slug" is not null;--> statement-breakpoint
CREATE INDEX "events_public_catalog_idx" ON "events" USING btree ("visibility","published_at","status","starts_at") WHERE "events"."visibility" = 'public' and "events"."published_at" is not null and "events"."slug" is not null;
