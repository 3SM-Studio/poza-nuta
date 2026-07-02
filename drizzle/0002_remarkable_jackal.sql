ALTER TABLE "events" ADD COLUMN "auto_close_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "events"
SET "auto_close_at" = now() + interval '8 hours',
    "updated_at" = now()
WHERE "status" = 'active'
  AND "is_active_public_event" = true
  AND "auto_close_at" IS NULL;
