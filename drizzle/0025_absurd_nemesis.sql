ALTER TABLE "public"."songs" ADD COLUMN "public_id" uuid;--> statement-breakpoint
ALTER TABLE "public"."songs" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid();
