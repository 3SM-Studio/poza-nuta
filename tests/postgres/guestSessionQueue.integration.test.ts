import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type postgres from "postgres";
import { test, vi } from "vitest";

import {
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
} from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

test("postgres:17-alpine: guest request and organizer queue lifecycle", async () => {
  const harness = await startPostgresTestHarness(
    "pozanuta-guest-session-queue",
    "postgres:17-alpine",
  );
  const sql = createPostgresTestClient(harness, "postgres", 4);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let applicationDatabase:
    | { $client: { end(options: { timeout: number }): Promise<void> } }
    | undefined;

  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, 20);
    const fixture = await seedFixture(sql);
    process.env.DATABASE_URL = makeDatabaseUrl(harness);

    const sessionService = await import("../../src/server/session-api/service.ts");
    const queueService = await import("../../src/server/operator-api/event-queue.ts");
    const { getDb } = await import("../../src/server/db.ts");
    applicationDatabase = getDb() as unknown as typeof applicationDatabase;

    const searchResults = await sessionService.searchSessionSongs(
      fixture.sessionCode,
      "evidence",
    );
    assert.equal(searchResults.length, 1);

    const concurrent = await Promise.allSettled([
      sessionService.createSessionRequest(fixture.sessionCode, {
        songId: fixture.songId,
        singerName: "Guest Evidence",
        note: null,
      }),
      sessionService.createSessionRequest(fixture.sessionCode, {
        songId: fixture.songId,
        singerName: "Guest Evidence",
        note: null,
      }),
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const duplicate = concurrent.find((result) => result.status === "rejected");
    assert.ok(duplicate && duplicate.status === "rejected");
    assert.equal(getErrorCode(duplicate.reason), "SESSION_REQUEST_DUPLICATE");
    assert.equal(getErrorStatus(duplicate.reason), 409);
    await assert.rejects(
      sessionService.createSessionRequest(fixture.sessionCode, {
        songId: fixture.songId,
        singerName: "guest evidence",
        note: null,
      }),
      (error: unknown) => getErrorCode(error) === "SESSION_REQUEST_DUPLICATE",
    );

    const [request] = await sql<{ id: number }[]>`
      SELECT id::integer
      FROM public.song_requests
      WHERE event_id = ${fixture.eventId}
        AND display_name = 'Guest Evidence'
    `;
    assert.ok(request);
    assert.equal(await countRequests(sql, fixture.eventId), 1);

    await applyAction(queueService, fixture, request.id, "approve", "approved");
    await applyAction(queueService, fixture, request.id, "restore", "pending");
    await applyAction(queueService, fixture, request.id, "start", "now");
    await applyAction(queueService, fixture, request.id, "done", "done");
    await applyAction(queueService, fixture, request.id, "restore", "pending");
    await applyAction(queueService, fixture, request.id, "reject", "rejected");
    await applyAction(queueService, fixture, request.id, "restore", "pending");

    const seeded = await seedTransitionFixtures(sql, fixture);
    await applyAction(
      queueService,
      fixture,
      seeded.approvedStart,
      "start",
      "now",
    );
    await applyAction(
      queueService,
      fixture,
      seeded.approvedReject,
      "reject",
      "rejected",
    );
    await applyAction(queueService, fixture, seeded.approvedDone, "done", "done");
    await applyAction(queueService, fixture, seeded.skippedRestore, "restore", "pending");

    await assert.rejects(
      queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId: fixture.eventId,
        requestId: seeded.approvedDone,
        action: "approve",
      }),
      (error: unknown) =>
        getErrorStatus(error) === 409 &&
        getErrorCode(error) === "INVALID_STATUS_TRANSITION",
    );

    await sql`
      UPDATE public.events
      SET status = 'closed', closed_at = now(), updated_at = now()
      WHERE id = ${fixture.eventId}
    `;
    await assert.rejects(
      sessionService.createSessionRequest(fixture.sessionCode, {
        songId: fixture.songId,
        singerName: "Closed Evidence",
        note: null,
      }),
      (error: unknown) => getErrorCode(error) === "SESSION_EVENT_CLOSED",
    );
    await assert.rejects(
      queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId: fixture.eventId,
        requestId: request.id,
        action: "approve",
      }),
      (error: unknown) =>
        getErrorStatus(error) === 409 &&
        getErrorCode(error) === "EVENT_QUEUE_CLOSED",
    );

    const [audit] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count
      FROM public.operator_audit_log
      WHERE event_id = ${fixture.eventId}
        AND action LIKE 'event_queue_%'
    `;
    assert.equal(audit.count, 11);
  } finally {
    if (applicationDatabase) {
      await applicationDatabase.$client.end({ timeout: 5 });
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    await sql.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
});

type Fixture = {
  authUserId: string;
  organizationId: string;
  workspaceId: number;
  eventId: number;
  songId: number;
  sessionCode: string;
};

async function seedFixture(sql: postgres.Sql): Promise<Fixture> {
  const authUserId = randomUUID();
  const organizationId = "guestqueuee2etest000";
  await sql`INSERT INTO auth.users (id) VALUES (${authUserId})`;
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Guest queue test', 'guest-queue-test', ${organizationId})
    RETURNING id::integer
  `;
  const [operator] = await sql<{ id: number }[]>`
    INSERT INTO public.operator_users (
      name, display_name, profile_completed_at, auth_user_id, password_hash
    )
    VALUES ('guest_queue_operator', 'Queue Operator', now(), ${authUserId}, 'test-only')
    RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.workspace_members (workspace_id, operator_user_id, role)
    VALUES (${workspace.id}, ${operator.id}, 'owner')
  `;
  const [event] = await sql<{ id: number; session_code: string }[]>`
    INSERT INTO public.events (
      workspace_id, name, starts_at, ends_at, auto_close_at, status,
      song_requests_enabled, public_queue_enabled, public_show_song_titles
    )
    VALUES (
      ${workspace.id}, 'Guest queue evidence', now() - interval '1 hour',
      now() + interval '2 hours', now() + interval '2 hours', 'active',
      true, true, true
    )
    RETURNING id::integer, session_code
  `;
  const [song] = await sql<{ id: number }[]>`
    INSERT INTO public.songs (
      source, source_song_id, title, artist, normalized_title,
      normalized_artist, search_text
    )
    VALUES (
      'ising', 'guest-evidence', 'Evidence Song', 'Evidence Artist',
      'evidence song', 'evidence artist', 'evidence song evidence artist'
    )
    RETURNING id::integer
  `;

  return {
    authUserId,
    organizationId,
    workspaceId: workspace.id,
    eventId: event.id,
    songId: song.id,
    sessionCode: event.session_code,
  };
}

async function seedTransitionFixtures(sql: postgres.Sql, fixture: Fixture) {
  const rows = await sql<{ id: number; display_name: string }[]>`
    INSERT INTO public.song_requests (
      event_id, song_id, singer_name, display_name, status, position,
      requested_by
    )
    VALUES
      (${fixture.eventId}, ${fixture.songId}, 'Start approved', 'Start approved', 'approved', 1, 'public'),
      (${fixture.eventId}, ${fixture.songId}, 'Reject approved', 'Reject approved', 'approved', 2, 'public'),
      (${fixture.eventId}, ${fixture.songId}, 'Done approved', 'Done approved', 'approved', 3, 'public'),
      (${fixture.eventId}, ${fixture.songId}, 'Restore skipped', 'Restore skipped', 'skipped', 0, 'public')
    RETURNING id::integer, display_name
  `;
  const ids = new Map(rows.map((row) => [row.display_name, row.id]));
  return {
    approvedStart: requireId(ids, "Start approved"),
    approvedReject: requireId(ids, "Reject approved"),
    approvedDone: requireId(ids, "Done approved"),
    skippedRestore: requireId(ids, "Restore skipped"),
  };
}

async function applyAction(
  service: typeof import("../../src/server/operator-api/event-queue.ts"),
  fixture: Fixture,
  requestId: number,
  action: "approve" | "start" | "reject" | "done" | "restore",
  expectedStatus: string,
) {
  const result =
    await service.applyDashboardOrganizationEventQueueActionForAuthUser({
      authUserId: fixture.authUserId,
      organizationId: fixture.organizationId,
      eventId: fixture.eventId,
      requestId,
      action,
    });
  assert.equal(result.request.status, expectedStatus);
}

async function countRequests(sql: postgres.Sql, eventId: number) {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM public.song_requests
    WHERE event_id = ${eventId}
  `;
  return row.count;
}

function makeDatabaseUrl(harness: {
  host: string;
  port: number;
  password: string;
}) {
  return `postgres://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

function getErrorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? error.status
    : undefined;
}

function requireId(ids: Map<string, number>, name: string) {
  const id = ids.get(name);
  assert.ok(id);
  return id;
}
