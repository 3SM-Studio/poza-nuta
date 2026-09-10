import assert from "node:assert/strict";
import { test } from "node:test";

import type postgres from "postgres";

import {
  applyPostgresMigration,
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "./postgresTestHarness.ts";

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;

for (const image of images) {
  test(`${image}: canonical session access backfill and constraints`, async () => {
    const harness = await startPostgresTestHarness(
      "pozanuta-canonical-session",
      image,
    );
    const sql = createPostgresTestClient(harness, "postgres", 12);

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 19);
      const workspaceId = await seedWorkspace(sql);
      const eventIds = await seedLegacyEvents(sql, workspaceId);
      await seedLegacyLinks(sql, eventIds);

      await applyPostgresMigration(sql, 20);

      const [codes] = await sql<{
        events: number;
        distinct_codes: number;
        invalid_codes: number;
      }[]>`
        SELECT
          count(*)::integer AS events,
          count(DISTINCT session_code)::integer AS distinct_codes,
          count(*) FILTER (WHERE session_code !~ '^[0-9]{8}$')::integer AS invalid_codes
        FROM public.events
      `;
      assert.deepEqual(codes, {
        events: eventIds.length,
        distinct_codes: eventIds.length,
        invalid_codes: 0,
      });

      const [legacy] = await sql<{ total: number; active: number }[]>`
        SELECT
          count(*)::integer AS total,
          count(*) FILTER (WHERE active OR revoked_at IS NULL)::integer AS active
        FROM public.event_access_links
      `;
      assert.deepEqual(legacy, { total: 3, active: 0 });

      const [metadata] = await sql<{
        valid: boolean;
        ready: boolean;
        unique_index: boolean;
      }[]>`
        SELECT i.indisvalid AS valid, i.indisready AS ready, i.indisunique AS unique_index
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.oid = 'public.events_session_code_idx'::regclass
      `;
      assert.deepEqual(metadata, {
        valid: true,
        ready: true,
        unique_index: true,
      });

      const insertedCodes = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          insertEvent(sql, workspaceId, `Concurrent ${index}`),
        ),
      );
      assert.equal(new Set(insertedCodes).size, insertedCodes.length);
      for (const code of insertedCodes) assert.match(code, /^[0-9]{8}$/);

      const duplicateCode = insertedCodes[0];
      const beforeCount = await countEvents(sql);
      await assert.rejects(
        insertEvent(sql, workspaceId, "Duplicate", duplicateCode),
        (error: unknown) =>
          isPostgresError(error, "23505", "events_session_code_idx"),
      );
      assert.equal(await countEvents(sql), beforeCount);
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });

  test(`${image}: migration fails before DDL when session_code already exists`, async () => {
    const harness = await startPostgresTestHarness(
      "pozanuta-canonical-preflight",
      image,
    );
    const sql = createPostgresTestClient(harness, "postgres");

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 19);
      await sql`ALTER TABLE public.events ADD COLUMN session_code text`;

      await assert.rejects(
        applyPostgresMigration(sql, 20),
        (error: unknown) =>
          isPostgresError(
            error,
            "23514",
            "canonical_session_access_preflight",
          ),
      );

      const [column] = await sql<{ nullable: string }[]>`
        SELECT is_nullable AS nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'events'
          AND column_name = 'session_code'
      `;
      assert.equal(column.nullable, "YES");
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });
}

async function seedWorkspace(sql: postgres.Sql) {
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Canonical test', 'canonical-test', 'canonicalsessiontest')
    RETURNING id::integer
  `;
  return workspace.id;
}

async function seedLegacyEvents(sql: postgres.Sql, workspaceId: number) {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO public.events (workspace_id, name, starts_at, ends_at)
    VALUES
      (${workspaceId}, 'Legacy one', now() - interval '1 hour', now() + interval '1 hour'),
      (${workspaceId}, 'Legacy two', now() + interval '1 hour', now() + interval '2 hours'),
      (${workspaceId}, 'Legacy three', now() - interval '2 hours', now() - interval '1 hour')
    RETURNING id::integer
  `;
  return rows.map((row) => row.id);
}

async function seedLegacyLinks(sql: postgres.Sql, eventIds: number[]) {
  await sql`
    INSERT INTO public.event_access_links (event_id, code_hash, label, active, revoked_at)
    VALUES
      (${eventIds[0]}, 'legacy-one', 'one', true, null),
      (${eventIds[0]}, 'legacy-two', 'two', false, now()),
      (${eventIds[1]}, 'legacy-three', 'three', true, null)
  `;
}

async function insertEvent(
  sql: postgres.Sql,
  workspaceId: number,
  name: string,
  sessionCode?: string,
) {
  const rows = sessionCode
    ? await sql<{ session_code: string }[]>`
        INSERT INTO public.events (workspace_id, name, session_code, starts_at, ends_at)
        VALUES (${workspaceId}, ${name}, ${sessionCode}, now(), now() + interval '1 hour')
        RETURNING session_code
      `
    : await sql<{ session_code: string }[]>`
        INSERT INTO public.events (workspace_id, name, starts_at, ends_at)
        VALUES (${workspaceId}, ${name}, now(), now() + interval '1 hour')
        RETURNING session_code
      `;
  return rows[0].session_code;
}

async function countEvents(sql: postgres.Sql) {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count FROM public.events
  `;
  return row.count;
}

function isPostgresError(error: unknown, code: string, constraint: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code &&
    (("constraint_name" in error && error.constraint_name === constraint) ||
      ("constraint" in error && error.constraint === constraint))
  );
}
