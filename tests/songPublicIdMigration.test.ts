import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertSongPublicIdBackfillTarget } from "../src/db/backfill-song-public-id.ts";

const migration = readFileSync("drizzle/0025_absurd_nemesis.sql", "utf8");
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};
const previousSnapshot = JSON.parse(readFileSync("drizzle/meta/0024_snapshot.json", "utf8")) as {
  tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, unknown> }>;
};
const snapshot = JSON.parse(readFileSync("drizzle/meta/0025_snapshot.json", "utf8")) as typeof previousSnapshot;

test("0025 journal and snapshot contain only the songs public identity addition", () => {
  const entry = journal.entries.find(({ idx }) => idx === 25);
  assert.deepEqual(entry, {
    ...entry,
    idx: 25,
    tag: "0025_absurd_nemesis",
  });
  assert.deepEqual(Object.keys(snapshot.tables), Object.keys(previousSnapshot.tables));
  for (const name of Object.keys(previousSnapshot.tables)) {
    const before = previousSnapshot.tables[name];
    const after = snapshot.tables[name];
    if (name !== "public.songs") {
      assert.deepEqual(after, before, `${name} must be unchanged`);
      continue;
    }
    const { public_id: publicId, ...previousColumns } = after.columns;
    assert.deepEqual(previousColumns, before.columns);
    assert.deepEqual(after.indexes, before.indexes);
    assert.deepEqual(publicId, {
      name: "public_id",
      type: "uuid",
      primaryKey: false,
      notNull: false,
      default: "gen_random_uuid()",
    });
  }
});

test("0025 only adds a nullable UUID then sets its database default", () => {
  assert.deepEqual(
    migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean),
    [
      'ALTER TABLE "public"."songs" ADD COLUMN "public_id" uuid;',
      'ALTER TABLE "public"."songs" ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid();',
    ],
  );
});

test("backfill CLI requires an exact, explicit Supabase project target", () => {
  const ref = "abcdefghijklmnopqrst";
  assert.doesNotThrow(() => assertSongPublicIdBackfillTarget(
    `postgresql://postgres.${ref}:placeholder@aws-0-region.pooler.supabase.com:5432/postgres`, ref,
  ));
  assert.doesNotThrow(() => assertSongPublicIdBackfillTarget(
    `postgresql://postgres:placeholder@db.${ref}.supabase.co:5432/postgres`, ref,
  ));
  for (const url of [
    `postgresql://postgres.zyxwvutsrqponmlkjihg:placeholder@aws-0-region.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${ref}:placeholder@db.${ref}.supabase.co:5432/postgres`,
    `postgresql://postgres.${ref}:placeholder@elsewhere.example:5432/postgres`,
    `postgresql://postgres.${ref}:placeholder@aws-0-region.pooler.supabase.com:5432/other`,
    `postgresql://postgres.${ref}:placeholder@aws-0-region.pooler.supabase.com:6543/postgres`,
    `https://postgres.${ref}:placeholder@aws-0-region.pooler.supabase.com:5432/postgres`,
    "invalid",
  ]) {
    assert.throws(() => assertSongPublicIdBackfillTarget(url, ref), /DIRECT_URL/);
  }
});
