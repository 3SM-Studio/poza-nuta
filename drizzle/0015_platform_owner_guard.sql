LOCK TABLE
  "public"."events",
  "public"."operator_users",
  "public"."platform_members",
  "public"."workspace_members",
  "public"."workspaces"
IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
CREATE TABLE "private"."platform_owner_guard" (
	"singleton_key" boolean PRIMARY KEY,
	"revision" bigint DEFAULT 0 NOT NULL,
	"armed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "platform_owner_guard_singleton_key_check" CHECK ("singleton_key" = true),
	CONSTRAINT "platform_owner_guard_revision_check" CHECK ("revision" >= 0)
);--> statement-breakpoint
REVOKE ALL ON TABLE "private"."platform_owner_guard" FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
DO $$
DECLARE
  eligible_owner_exists boolean;
  operator_count bigint;
  platform_member_count bigint;
  workspace_member_count bigint;
  event_count bigint;
  workspace_count bigint;
  legacy_workspace_count bigint;
  initial_armed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM "public"."platform_members"
    INNER JOIN "public"."operator_users"
      ON "operator_users"."id" = "platform_members"."operator_user_id"
    WHERE "operator_users"."active" = true
      AND "operator_users"."suspended_at" IS NULL
      AND "platform_members"."active" = true
      AND "platform_members"."role" = 'platform_owner'
  ) INTO eligible_owner_exists;

  SELECT count(*) INTO operator_count FROM "public"."operator_users";
  SELECT count(*) INTO platform_member_count FROM "public"."platform_members";
  SELECT count(*) INTO workspace_member_count FROM "public"."workspace_members";
  SELECT count(*) INTO event_count FROM "public"."events";
  SELECT
    count(*),
    count(*) FILTER (
      WHERE "workspaces"."name" = 'Poza Nutą'
        AND "workspaces"."handle" = 'pozanuta'
    )
  INTO workspace_count, legacy_workspace_count
  FROM "public"."workspaces";

  IF eligible_owner_exists THEN
    initial_armed := true;
  ELSIF operator_count = 0
    AND platform_member_count = 0
    AND workspace_member_count = 0
    AND event_count = 0
    AND (
      workspace_count = 0
      OR (workspace_count = 1 AND legacy_workspace_count = 1)
    ) THEN
    initial_armed := false;
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'eligible_platform_owner_required',
      MESSAGE = 'Eligible platform owner invariant violated.';
  END IF;

  INSERT INTO "private"."platform_owner_guard" (
    "singleton_key",
    "revision",
    "armed"
  ) VALUES (true, 0, initial_armed);
END;
$$;--> statement-breakpoint
CREATE FUNCTION "private"."serialize_platform_owner_transition"()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_rows bigint;
BEGIN
  UPDATE "private"."platform_owner_guard"
  SET "revision" = "revision" + 1
  WHERE "singleton_key" = true;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;

  IF updated_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'eligible_platform_owner_required',
      MESSAGE = 'Eligible platform owner invariant violated.';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "private"."validate_and_arm_platform_owner_guard"()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  guard_armed boolean;
  eligible_owner_exists boolean;
  platform_member_exists boolean;
BEGIN
  SELECT "armed"
  INTO guard_armed
  FROM "private"."platform_owner_guard"
  WHERE "singleton_key" = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'eligible_platform_owner_required',
      MESSAGE = 'Eligible platform owner invariant violated.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "public"."platform_members"
    INNER JOIN "public"."operator_users"
      ON "operator_users"."id" = "platform_members"."operator_user_id"
    WHERE "operator_users"."active" = true
      AND "operator_users"."suspended_at" IS NULL
      AND "platform_members"."active" = true
      AND "platform_members"."role" = 'platform_owner'
  ) INTO eligible_owner_exists;

  IF eligible_owner_exists THEN
    IF NOT guard_armed THEN
      UPDATE "private"."platform_owner_guard"
      SET "armed" = true
      WHERE "singleton_key" = true;
    END IF;

    RETURN NULL;
  END IF;

  IF guard_armed THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'eligible_platform_owner_required',
      MESSAGE = 'Eligible platform owner invariant violated.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "public"."platform_members"
  ) INTO platform_member_exists;

  IF platform_member_exists THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'eligible_platform_owner_required',
      MESSAGE = 'Eligible platform owner invariant violated.';
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "private"."protect_platform_owner_guard"()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'eligible_platform_owner_required',
      MESSAGE = 'Eligible platform owner invariant violated.';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."singleton_key" IS DISTINCT FROM OLD."singleton_key"
    OR (OLD."armed" = true AND NEW."armed" = false)
    OR NEW."revision" < OLD."revision"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'eligible_platform_owner_required',
      MESSAGE = 'Eligible platform owner invariant violated.';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."serialize_platform_owner_transition"() FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."validate_and_arm_platform_owner_guard"() FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON FUNCTION "private"."protect_platform_owner_guard"() FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
CREATE TRIGGER "a_operator_users_platform_owner_guard_serialize"
BEFORE UPDATE OF "active", "suspended_at" OR DELETE
ON "public"."operator_users"
FOR EACH STATEMENT
EXECUTE FUNCTION "private"."serialize_platform_owner_transition"();--> statement-breakpoint
CREATE TRIGGER "z_operator_users_platform_owner_guard_validate"
AFTER UPDATE OF "active", "suspended_at" OR DELETE
ON "public"."operator_users"
FOR EACH STATEMENT
EXECUTE FUNCTION "private"."validate_and_arm_platform_owner_guard"();--> statement-breakpoint
CREATE TRIGGER "a_platform_members_platform_owner_guard_serialize"
BEFORE INSERT OR UPDATE OF "operator_user_id", "role", "active" OR DELETE
ON "public"."platform_members"
FOR EACH STATEMENT
EXECUTE FUNCTION "private"."serialize_platform_owner_transition"();--> statement-breakpoint
CREATE TRIGGER "z_platform_members_platform_owner_guard_validate"
AFTER INSERT OR UPDATE OF "operator_user_id", "role", "active" OR DELETE
ON "public"."platform_members"
FOR EACH STATEMENT
EXECUTE FUNCTION "private"."validate_and_arm_platform_owner_guard"();--> statement-breakpoint
CREATE TRIGGER "a_operator_users_platform_owner_guard_no_truncate"
BEFORE TRUNCATE
ON "public"."operator_users"
FOR EACH STATEMENT
EXECUTE FUNCTION "private"."protect_platform_owner_guard"();--> statement-breakpoint
CREATE TRIGGER "a_platform_members_platform_owner_guard_no_truncate"
BEFORE TRUNCATE
ON "public"."platform_members"
FOR EACH STATEMENT
EXECUTE FUNCTION "private"."protect_platform_owner_guard"();--> statement-breakpoint
CREATE TRIGGER "a_platform_owner_guard_protect"
BEFORE DELETE OR UPDATE OF "singleton_key", "revision", "armed"
ON "private"."platform_owner_guard"
FOR EACH ROW
EXECUTE FUNCTION "private"."protect_platform_owner_guard"();--> statement-breakpoint
CREATE TRIGGER "a_platform_owner_guard_no_truncate"
BEFORE TRUNCATE
ON "private"."platform_owner_guard"
FOR EACH STATEMENT
EXECUTE FUNCTION "private"."protect_platform_owner_guard"();
