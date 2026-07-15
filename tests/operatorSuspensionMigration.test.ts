import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "drizzle/0013_operator_suspension.sql";

test("operator suspension migration is additive and preserves existing users", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(
    migration,
    /ADD COLUMN "suspended_at" timestamp with time zone;/,
  );
  assert.match(migration, /ADD COLUMN "suspension_reason" text;/);
  assert.match(
    migration,
    /ADD COLUMN "suspended_by_operator_id" bigint;/,
  );
  assert.doesNotMatch(
    migration,
    /ADD COLUMN "(?:suspended_at|suspension_reason|suspended_by_operator_id)"[^;]*(?:NOT NULL|DEFAULT)/i,
  );
  assert.doesNotMatch(
    migration,
    /(?:^|\n)\s*(?:UPDATE|DELETE FROM|TRUNCATE)\b/i,
  );
  assert.doesNotMatch(migration, /ALTER TABLE "(?:platform_members|auth\.)/i);
});

test("operator suspension schema rejects every partial suspension state", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(schema, /suspendedAt: timestampColumn\("suspended_at"\)/);
  assert.match(schema, /suspensionReason: text\("suspension_reason"\)/);
  assert.match(
    schema,
    /suspendedByOperatorId: bigint\("suspended_by_operator_id"/,
  );
  assert.match(schema, /operator_users_suspension_state_check/);
  assert.match(schema, /operatorSuspensionReasonMaxLength = 500/);
  assert.match(schema, /char_length\(\$\{table\.suspensionReason\}\)/);
  assert.match(schema, /btrim\(\$\{table\.suspensionReason\}\)/);

  assert.match(migration, /operator_users_suspension_state_check/);
  assert.match(
    migration,
    /suspended_at[^\n]*is null[^\n]*suspension_reason[^\n]*is null[^\n]*suspended_by_operator_id[^\n]*is null/i,
  );
  assert.match(migration, /suspended_at[^\n]*is not null/i);
  assert.match(migration, /suspension_reason[^\n]*is not null/i);
  assert.match(
    migration,
    /char_length\([^)]*suspension_reason[^)]*\) between 1 and 500/i,
  );
  assert.match(
    migration,
    /suspension_reason[^\n]*= btrim\([^)]*suspension_reason[^)]*\)/i,
  );
  assert.match(migration, /suspended_by_operator_id[^\n]*is not null/i);

  assert.match(
    migration,
    /FOREIGN KEY \("suspended_by_operator_id"\) REFERENCES "public"\."operator_users"\("id"\) ON DELETE restrict/i,
  );
});

test("suspended operators cannot authorize dashboard Realtime", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION "private"\."is_active_dashboard_operator"\(\)/,
  );
  assert.match(migration, /"active" = true/);
  assert.match(migration, /"suspended_at" IS NULL/);
});

test("signup and setup explicitly create unsuspended local users", () => {
  const signup = readFileSync(
    "src/server/operator-api/supabase-session.ts",
    "utf8",
  );
  const setup = readFileSync("src/server/setup/service.ts", "utf8");

  for (const source of [signup, setup]) {
    assert.match(source, /suspendedAt: null/);
    assert.match(source, /suspensionReason: null/);
    assert.match(source, /suspendedByOperatorId: null/);
  }
});

test("complete owner links require an active unsuspended platform owner", () => {
  const setup = readFileSync("src/server/setup/service.ts", "utf8");
  const queryStart = setup.indexOf("async function countCompleteOwnerLinks");
  const querySource = setup.slice(queryStart);

  assert.notEqual(queryStart, -1);
  assert.match(querySource, /eq\(operatorUsers\.active, true\)/);
  assert.match(querySource, /isNull\(operatorUsers\.suspendedAt\)/);
  assert.match(
    querySource,
    /eq\(platformMembers\.role, "platform_owner"\)/,
  );
  assert.match(querySource, /eq\(platformMembers\.active, true\)/);
});

test("Ticket 5 does not modify Supabase Auth identity or platform membership", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const session = readFileSync(
    "src/server/operator-api/supabase-session.ts",
    "utf8",
  );

  assert.doesNotMatch(migration, /"auth"\."users"|"platform_members"/i);
  assert.doesNotMatch(session, /auth\.admin|updateUserById|deleteUser/);
});
