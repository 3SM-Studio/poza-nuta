ALTER TYPE "public"."import_job_status" ADD VALUE 'queued';--> statement-breakpoint
ALTER TYPE "public"."import_job_status" ADD VALUE 'succeeded';--> statement-breakpoint
ALTER TYPE "public"."import_job_status" ADD VALUE 'cancelled';