ALTER TYPE "public"."event_status" ADD VALUE IF NOT EXISTS 'cancelled';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "song_requests_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
UPDATE "events"
SET "song_requests_enabled" = "public_queue_enabled"
WHERE "song_requests_enabled" = false
  AND "public_queue_enabled" = true;--> statement-breakpoint
UPDATE "events"
SET "ends_at" = COALESCE("auto_close_at", "starts_at" + interval '8 hours')
WHERE "ends_at" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "events" WHERE "ends_at" IS NULL) THEN
    RAISE EXCEPTION 'events.ends_at backfill left null values';
  END IF;

  IF EXISTS (SELECT 1 FROM "events" WHERE "ends_at" <= "starts_at") THEN
    RAISE EXCEPTION 'events.ends_at must be after starts_at';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "ends_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_ends_after_starts_check" CHECK ("events"."ends_at" > "events"."starts_at");
