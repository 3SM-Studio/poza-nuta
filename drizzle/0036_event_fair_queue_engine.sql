-- Expand/backfill/verify/constrain. Existing sessions retain their algorithm.
-- No queue rows, positions, statuses, performance history or sort actions change.
ALTER TABLE "events" ADD COLUMN "fair_queue_engine" text;--> statement-breakpoint
UPDATE "events" SET "fair_queue_engine" = 'legacy' WHERE "fair_queue_engine" IS NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "fair_queue_engine" SET DEFAULT 'rotation-v2';--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "fair_queue_engine" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_fair_queue_engine_check" CHECK ("events"."fair_queue_engine" in ('legacy', 'rotation-v2'));
-- Verify: no NULL/unknown engines; existing event IDs remain legacy; new inserts
-- default rotation-v2; compare queue/history counts and digests before/after.
-- Rollback: KUNESTU_FAIR_QUEUE_ENGINE=legacy disables v2 for all operations;
-- keep column/config/history. No down migration, DELETE, or automatic Fair Sort.
