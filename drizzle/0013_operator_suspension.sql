ALTER TABLE "operator_users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operator_users" ADD COLUMN "suspension_reason" text;--> statement-breakpoint
ALTER TABLE "operator_users" ADD COLUMN "suspended_by_operator_id" bigint;--> statement-breakpoint
ALTER TABLE "operator_users" ADD CONSTRAINT "operator_users_suspended_by_operator_id_operator_users_id_fk" FOREIGN KEY ("suspended_by_operator_id") REFERENCES "public"."operator_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_users" ADD CONSTRAINT "operator_users_suspension_state_check" CHECK ((
        ("operator_users"."suspended_at" is null and "operator_users"."suspension_reason" is null and "operator_users"."suspended_by_operator_id" is null)
        or
        (
          "operator_users"."suspended_at" is not null
          and "operator_users"."suspension_reason" is not null
          and char_length("operator_users"."suspension_reason") between 1 and 500
          and "operator_users"."suspension_reason" = btrim("operator_users"."suspension_reason")
          and "operator_users"."suspended_by_operator_id" is not null
        )
      ));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "private"."is_active_dashboard_operator"()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "public"."operator_users"
    WHERE "operator_users"."auth_user_id" = (SELECT "auth"."uid"())
      AND "operator_users"."active" = true
      AND "operator_users"."suspended_at" IS NULL
  );
$$;
