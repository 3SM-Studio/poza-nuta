ALTER TABLE "workspaces" ADD COLUMN "public_id" text;--> statement-breakpoint
UPDATE "workspaces"
SET "public_id" = substr(md5('workspace-public-id-v1:' || "id"::text), 1, 20)
WHERE "public_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_public_id_idx" ON "workspaces" USING btree ("public_id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_public_id_format_check" CHECK ("workspaces"."public_id" ~ '^[a-z0-9]{20}$');--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "public_id" SET NOT NULL;
