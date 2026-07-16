import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../../src/db/schema.ts";
import { readPlatformAdminOverviewMetrics } from "../../src/server/platform-admin/overview-store.ts";
import {
  applyPostgresMigrations,
  createPostgresDatabase,
  createPostgresTestClient,
  dropPostgresDatabase,
  installPostgresCompatibilityFixture,
  postgresDatabaseName,
  postgresTestContainerExists,
  removePostgresTestHarness,
  startPostgresTestHarness,
} from "./postgresTestHarness.ts";

test(
  "platform admin Overview returns exact read-only aggregate counts",
  { timeout: 600_000 },
  async () => {
    const harness = await startPostgresTestHarness(
      "pozanuta-platform-admin-overview",
    );
    const admin = createPostgresTestClient(harness, "postgres");
    const databaseName = postgresDatabaseName("platform_admin_overview");

    try {
      await createPostgresDatabase(admin, databaseName);
      const sql = createPostgresTestClient(harness, databaseName);

      try {
        await installPostgresCompatibilityFixture(sql);
        await applyPostgresMigrations(sql, 15);
        await seedOverviewFixtures(sql);

        const database = drizzle({ client: sql, schema });
        const metrics = await readPlatformAdminOverviewMetrics(database);

        assert.deepEqual(metrics, {
          activeOperators: 2,
          eligibleOwners: 1,
          activePlatformMemberships: {
            platform_owner: 1,
            platform_admin: 1,
            support: 1,
          },
          activeWorkspaces: 2,
          catalogSongs: 2,
          activePublicEvents: 1,
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    } finally {
      await dropPostgresDatabase(admin, databaseName);
      await admin.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }

    assert.equal(
      await postgresTestContainerExists(harness.containerName),
      false,
      "Overview test container must be removed",
    );
  },
);

async function seedOverviewFixtures(
  sql: ReturnType<typeof createPostgresTestClient>,
) {
  const ownerId = await insertOperator(sql, "overview_owner", {
    active: true,
    suspended: false,
  });
  const adminId = await insertOperator(sql, "overview_admin", {
    active: true,
    suspended: false,
  });
  const suspendedSupportId = await insertOperator(sql, "overview_support", {
    active: true,
    suspended: true,
    suspendedByOperatorId: ownerId,
  });
  const inactiveId = await insertOperator(sql, "overview_inactive", {
    active: false,
    suspended: false,
  });

  await sql`
    INSERT INTO platform_members (operator_user_id, role, active)
    VALUES
      (${ownerId}, 'platform_owner', true),
      (${adminId}, 'platform_admin', true),
      (${suspendedSupportId}, 'support', true),
      (${inactiveId}, 'support', false)
  `;

  await sql`UPDATE workspaces SET active = false`;
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO workspaces (public_id, name, handle, active)
    VALUES
      ('aaaaaaaaaaaaaaaaaaaa', 'Active A', 'active-a', true),
      ('bbbbbbbbbbbbbbbbbbbb', 'Active B', 'active-b', true),
      ('cccccccccccccccccccc', 'Inactive', 'inactive-c', false)
    RETURNING id::int AS id
  `;
  assert.ok(workspace);

  await sql`
    INSERT INTO songs (
      source,
      source_song_id,
      title,
      artist,
      normalized_title,
      normalized_artist,
      search_text
    )
    VALUES
      ('manual', 'overview-1', 'Song One', 'Artist One', 'song one', 'artist one', 'song one artist one'),
      ('manual', 'overview-2', 'Song Two', 'Artist Two', 'song two', 'artist two', 'song two artist two')
  `;

  await sql`
    INSERT INTO events (
      workspace_id,
      name,
      slug,
      starts_at,
      ends_at,
      status,
      visibility,
      published_at,
      is_active_public_event
    )
    VALUES
      (${workspace.id}, 'Active public', 'overview-active', now() - interval '1 hour', now() + interval '1 hour', 'active', 'public', now(), true),
      (${workspace.id}, 'Inactive public', 'overview-inactive', now() - interval '1 hour', now() + interval '1 hour', 'active', 'public', now(), false)
  `;
}

async function insertOperator(
  sql: ReturnType<typeof createPostgresTestClient>,
  name: string,
  input: {
    active: boolean;
    suspended: boolean;
    suspendedByOperatorId?: number;
  },
) {
  const [operator] = await sql<{ id: number }[]>`
    INSERT INTO operator_users (
      name,
      password_hash,
      active,
      suspended_at,
      suspension_reason,
      suspended_by_operator_id
    )
    VALUES (
      ${name},
      'test-only-placeholder',
      ${input.active},
      ${input.suspended ? new Date() : null},
      ${input.suspended ? "Overview fixture" : null},
      ${input.suspendedByOperatorId ?? null}
    )
    RETURNING id::int AS id
  `;

  assert.ok(operator);
  return operator.id;
}
