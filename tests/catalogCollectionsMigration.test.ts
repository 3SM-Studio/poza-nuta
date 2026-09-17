import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "drizzle/0026_hesitant_quasimodo.sql",
  "utf8",
);
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};
const previousSnapshot = JSON.parse(
  readFileSync("drizzle/meta/0025_snapshot.json", "utf8"),
) as Snapshot;
const snapshot = JSON.parse(
  readFileSync("drizzle/meta/0026_snapshot.json", "utf8"),
) as Snapshot;

type Snapshot = {
  tables: Record<string, unknown>;
  enums: Record<string, unknown>;
};

test("0026 snapshot adds only global catalog collection objects", () => {
  assert.deepEqual(journal.entries.at(-1), {
    ...journal.entries.at(-1),
    idx: 26,
    tag: "0026_hesitant_quasimodo",
  });

  for (const [name, table] of Object.entries(previousSnapshot.tables)) {
    assert.deepEqual(snapshot.tables[name], table, `${name} must be unchanged`);
  }
  assert.deepEqual(
    Object.keys(snapshot.tables).filter((name) => !(name in previousSnapshot.tables)).sort(),
    ["public.catalog_collection_items", "public.catalog_collections"],
  );

  for (const [name, value] of Object.entries(previousSnapshot.enums)) {
    assert.deepEqual(snapshot.enums[name], value, `${name} must be unchanged`);
  }
  assert.deepEqual(
    Object.keys(snapshot.enums).filter((name) => !(name in previousSnapshot.enums)).sort(),
    [
      "public.catalog_collection_mode",
      "public.catalog_collection_section",
      "public.catalog_collection_type",
    ],
  );
});

test("0026 is additive and enforces global identity, membership and ordering", () => {
  assert.doesNotMatch(
    migration,
    /^(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/im,
  );
  assert.doesNotMatch(migration, /event_id|workspace_id|songs_public_id/i);
  assert.match(migration, /CREATE UNIQUE INDEX "catalog_collections_public_id_idx"/);
  assert.match(migration, /CREATE UNIQUE INDEX "catalog_collections_filter_key_idx"/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "catalog_collection_items_collection_song_idx"[\s\S]*"collection_id","song_id"/,
  );
  assert.match(
    migration,
    /CREATE INDEX "catalog_collection_items_collection_position_id_idx"[\s\S]*"collection_id","position","id"/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("song_id"\) REFERENCES "public"\."songs"\("id"\) ON DELETE restrict/,
  );
  assert.match(migration, /\^pl_\[a-z0-9\]/);
  assert.match(migration, /\^st_\[a-z0-9\]/);
  assert.match(migration, /"public_id" uuid DEFAULT gen_random_uuid\(\) NOT NULL/);
  assert.match(migration, /"catalog_collections_section_type_mode_check"/);
  assert.match(migration, /jsonb_build_object\('genre'/);
  assert.match(migration, /"catalog_collections_rule_config_check"/);
  assert.match(migration, /"catalog_collections_position_check"/);
  assert.match(migration, /"catalog_collection_items_position_check"/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE "public"\."catalog_collections", "public"\."catalog_collection_items" FROM PUBLIC, "anon", "authenticated"/);
  assert.match(migration, /GRANT SELECT ON TABLE "public"\."catalog_collections", "public"\."catalog_collection_items" TO "postgres"/);
  assert.doesNotMatch(migration, /CREATE POLICY|FORCE ROW LEVEL SECURITY/i);
});
