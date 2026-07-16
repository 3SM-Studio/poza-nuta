import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "drizzle/0016_import_job_status_expand.sql";
const previousSnapshotPath = "drizzle/meta/0015_snapshot.json";
const snapshotPath = "drizzle/meta/0016_snapshot.json";

type Snapshot = {
  id: string;
  prevId: string;
  enums: Record<string, { values: string[] }>;
};

type Journal = {
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

test("0016 adds exactly the three expand-phase import job statuses", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const values = Array.from(
    migration.matchAll(/ADD VALUE '([^']+)'/g),
    (match) => match[1],
  );

  assert.deepEqual(values, ["queued", "succeeded", "cancelled"]);
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE|INSERT|DELETE|DROP|CREATE\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/i,
  );

  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(statements.length, 3);
  for (const statement of statements) {
    assert.match(
      statement,
      /^ALTER TYPE "public"\."import_job_status" ADD VALUE '(?:queued|succeeded|cancelled)';?$/,
    );
  }
});

test("0016 snapshot changes only metadata and import job enum values", () => {
  const previous = JSON.parse(
    readFileSync(previousSnapshotPath, "utf8"),
  ) as Snapshot;
  const next = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  assert.equal(next.prevId, previous.id);
  assert.deepEqual(previous.enums["public.import_job_status"]?.values, [
    "pending",
    "running",
    "done",
    "failed",
  ]);
  assert.deepEqual(next.enums["public.import_job_status"]?.values, [
    "pending",
    "running",
    "done",
    "failed",
    "queued",
    "succeeded",
    "cancelled",
  ]);

  const normalizedNext = structuredClone(next);
  normalizedNext.id = previous.id;
  normalizedNext.prevId = previous.prevId;
  normalizedNext.enums["public.import_job_status"]!.values = [
    ...previous.enums["public.import_job_status"]!.values,
  ];
  assert.deepEqual(normalizedNext, previous);
});

test("0016 follows 0015 in the migration journal", () => {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as Journal;
  const previous = journal.entries.at(-2);
  const current = journal.entries.at(-1);

  assert.deepEqual(previous, {
    idx: 15,
    tag: "0015_platform_owner_guard",
    version: "7",
    when: previous?.when,
    breakpoints: true,
  });
  assert.deepEqual(current, {
    idx: 16,
    tag: "0016_import_job_status_expand",
    version: "7",
    when: current?.when,
    breakpoints: true,
  });
});
