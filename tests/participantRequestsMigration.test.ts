import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("0024 adds a non-sequential public request id with safe backfill ordering", () => {
  const migration = readFileSync(
    "drizzle/0024_remarkable_brother_voodoo.sql",
    "utf8",
  );
  const add = migration.indexOf('ADD COLUMN "public_id" uuid');
  const backfill = migration.indexOf('SET "public_id" = gen_random_uuid()');
  const disableTrigger = migration.indexOf('DISABLE TRIGGER "song_requests_broadcast_queue_changed_trigger"');
  const enableTrigger = migration.indexOf('ENABLE TRIGGER "song_requests_broadcast_queue_changed_trigger"');
  const verify = migration.indexOf("backfill is incomplete");
  const notNull = migration.indexOf('ALTER COLUMN "public_id" SET NOT NULL');
  const unique = migration.indexOf('CREATE UNIQUE INDEX "song_requests_public_id_idx"');
  assert.ok(add >= 0 && add < backfill && backfill < verify && verify < notNull && notNull < unique);
  assert.ok(disableTrigger > add && disableTrigger < backfill);
  assert.ok(enableTrigger > backfill && enableTrigger < verify);
  assert.doesNotMatch(migration, /ADD COLUMN "public_id" uuid[^;]*NOT NULL/);
});

test("0024 runbook documents write locks, verification, and forward fixes", () => {
  const runbook = readFileSync(
    "docs/migrations/0024-song-request-public-id.md",
    "utf8",
  );

  assert.match(runbook, /updates every existing `song_requests` row/i);
  assert.match(runbook, /temporarily delay request writes/i);
  assert.match(runbook, /controlled low-traffic window/i);
  assert.match(runbook, /Before rollout/i);
  assert.match(runbook, /After rollout/i);
  assert.match(runbook, /forward fix/i);
  assert.match(runbook, /rolls back.*temporary\s+trigger state/is);
});
