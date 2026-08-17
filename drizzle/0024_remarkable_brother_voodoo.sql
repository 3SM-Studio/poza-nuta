ALTER TABLE "song_requests" ADD COLUMN "public_id" uuid;--> statement-breakpoint
ALTER TABLE "song_requests" DISABLE TRIGGER "song_requests_broadcast_queue_changed_trigger";--> statement-breakpoint
UPDATE "song_requests"
SET "public_id" = gen_random_uuid()
WHERE "public_id" IS NULL;--> statement-breakpoint
ALTER TABLE "song_requests" ENABLE TRIGGER "song_requests_broadcast_queue_changed_trigger";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "song_requests" WHERE "public_id" IS NULL) THEN
    RAISE EXCEPTION 'song_requests.public_id backfill is incomplete';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "song_requests" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "song_requests" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "song_requests_public_id_idx" ON "song_requests" USING btree ("public_id");
