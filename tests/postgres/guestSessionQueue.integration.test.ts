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

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;

for (const image of images) {
test(`${image}: guest request and event-scoped organizer queue lifecycle`, async () => {
  const harness = await startPostgresTestHarness(
    "pozanuta-guest-session-queue",
    image,
  );
  const sql = createPostgresTestClient(harness, "postgres", 4);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let applicationDatabase:
    | { $client: { end(options: { timeout: number }): Promise<void> } }
    | undefined;

  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, 21);
    await sql`DROP INDEX public.events_one_active_public_per_workspace_idx`;
    const fixture = await seedFixture(sql);
    process.env.DATABASE_URL = makeDatabaseUrl(harness);

    const sessionService = await import("../../src/server/session-api/service.ts");
    const queueService = await import("../../src/server/operator-api/event-queue.ts");
    const eventService = await import(
      "../../src/server/operator-api/organizations.ts"
    );
    const { getDb } = await import("../../src/server/db.ts");
    applicationDatabase = getDb() as unknown as typeof applicationDatabase;

    await assertEventScopedIsolation(
      harness,
      sql,
      fixture,
      queueService,
      eventService,
    );

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
        eventId: fixture.eventPublicId,
        requestId: seeded.approvedDone,
        action: "approve",
      }),
      (error: unknown) =>
        getErrorStatus(error) === 409 &&
        getErrorCode(error) === "INVALID_STATUS_TRANSITION",
    );

    await sql`
      UPDATE public.events
      SET
        status = 'closed',
        is_active_public_event = false,
        closed_at = now(),
        close_reason = 'manual',
        updated_at = now()
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
        eventId: fixture.eventPublicId,
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
      clearApplicationDatabase();
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
}

type Fixture = {
  authUserId: string;
  organizationId: string;
  workspaceId: number;
  eventId: number;
  eventPublicId: string;
  secondEventId: number;
  secondEventPublicId: string;
  secondRequestId: number;
  crossWorkspaceEventPublicId: string;
  membershipId: number;
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
  const [membership] = await sql<{ id: number }[]>`
    INSERT INTO public.workspace_members (workspace_id, operator_user_id, role)
    VALUES (${workspace.id}, ${operator.id}, 'owner')
    RETURNING id::integer
  `;
  const [event] = await sql<{
    id: number;
    public_id: string;
    session_code: string;
  }[]>`
    INSERT INTO public.events (
      workspace_id, name, starts_at, ends_at, auto_close_at, status,
      is_active_public_event,
      song_requests_enabled, public_queue_enabled, public_show_song_titles
    )
    VALUES (
      ${workspace.id}, 'Guest queue evidence', now() - interval '1 hour',
      now() + interval '2 hours', now() + interval '2 hours', 'active', true,
      true, true, true
    )
    RETURNING id::integer, public_id::text, session_code
  `;
  const [session] = await sql<{ id: number }[]>`
    INSERT INTO public.event_sessions (event_id, public_token)
    VALUES (${event.id}, ${makePublicToken()})
    RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.event_session_codes (
      session_id, code, rotation_reason
    )
    VALUES (${session.id}, ${event.session_code}, 'initial')
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
  const [secondEvent] = await sql<{
    id: number;
    public_id: string;
  }[]>`
    INSERT INTO public.events (
      workspace_id, name, starts_at, ends_at, auto_close_at, status,
      is_active_public_event, song_requests_enabled, public_queue_enabled,
      public_show_song_titles
    )
    VALUES (
      ${workspace.id}, 'Second active event', now() - interval '30 minutes',
      now() + interval '3 hours', now() + interval '3 hours', 'active', true,
      true, true, true
    )
    RETURNING id::integer, public_id::text
  `;
  const [secondRequest] = await sql<{ id: number }[]>`
    INSERT INTO public.song_requests (
      event_id, song_id, singer_name, display_name, status, position,
      requested_by
    )
    VALUES (
      ${secondEvent.id}, ${song.id}, 'Second Event Guest',
      'Second Event Guest', 'pending', 0, 'public'
    )
    RETURNING id::integer
  `;
  const [otherWorkspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Other workspace', 'other-workspace', 'otherworkspaceevent0')
    RETURNING id::integer
  `;
  const [crossWorkspaceEvent] = await sql<{ public_id: string }[]>`
    INSERT INTO public.events (
      workspace_id, name, starts_at, ends_at, auto_close_at, status,
      is_active_public_event
    )
    VALUES (
      ${otherWorkspace.id}, 'Cross workspace event',
      now() - interval '15 minutes', now() + interval '2 hours',
      now() + interval '2 hours', 'active', true
    )
    RETURNING public_id::text
  `;

  return {
    authUserId,
    organizationId,
    workspaceId: workspace.id,
    eventId: event.id,
    eventPublicId: event.public_id,
    secondEventId: secondEvent.id,
    secondEventPublicId: secondEvent.public_id,
    secondRequestId: secondRequest.id,
    crossWorkspaceEventPublicId: crossWorkspaceEvent.public_id,
    membershipId: membership.id,
    songId: song.id,
    sessionCode: event.session_code,
  };
}

async function assertEventScopedIsolation(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  sql: postgres.Sql,
  fixture: Fixture,
  queueService: typeof import("../../src/server/operator-api/event-queue.ts"),
  eventService: typeof import("../../src/server/operator-api/organizations.ts"),
) {
  const [firstQueue, secondQueue, crossWorkspaceQueue] = await Promise.all([
    queueService.getDashboardOrganizationEventQueueForAuthUser({
      authUserId: fixture.authUserId,
      organizationId: fixture.organizationId,
      eventId: fixture.eventPublicId,
    }),
    queueService.getDashboardOrganizationEventQueueForAuthUser({
      authUserId: fixture.authUserId,
      organizationId: fixture.organizationId,
      eventId: fixture.secondEventPublicId,
    }),
    queueService.getDashboardOrganizationEventQueueForAuthUser({
      authUserId: fixture.authUserId,
      organizationId: fixture.organizationId,
      eventId: fixture.crossWorkspaceEventPublicId,
    }),
  ]);

  assert.ok(firstQueue);
  assert.ok(secondQueue);
  assert.equal(firstQueue.event.id, fixture.eventId);
  assert.deepEqual(firstQueue.items, []);
  assert.equal(secondQueue.event.id, fixture.secondEventId);
  assert.deepEqual(
    secondQueue.items.map(({ id }) => id),
    [fixture.secondRequestId],
  );
  assert.equal(crossWorkspaceQueue, null);

  await assert.rejects(
    queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
      authUserId: fixture.authUserId,
      organizationId: fixture.organizationId,
      eventId: fixture.eventPublicId,
      requestId: fixture.secondRequestId,
      action: "approve",
    }),
    (error: unknown) =>
      getErrorStatus(error) === 404 &&
      getErrorCode(error) === "REQUEST_NOT_FOUND",
  );
  await assert.rejects(
    queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
      authUserId: fixture.authUserId,
      organizationId: fixture.organizationId,
      eventId: fixture.crossWorkspaceEventPublicId,
      requestId: fixture.secondRequestId,
      action: "approve",
    }),
    (error: unknown) =>
      getErrorStatus(error) === 404 &&
      getErrorCode(error) === "EVENT_NOT_FOUND",
  );

  const approved =
    await queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
      authUserId: fixture.authUserId,
      organizationId: fixture.organizationId,
      eventId: fixture.secondEventPublicId,
      requestId: fixture.secondRequestId,
      action: "approve",
    });
  assert.equal(approved.event.id, fixture.secondEventId);
  assert.equal(approved.request.status, "approved");

  await assertQueueRbacRecheckAfterEventLock(
    harness,
    sql,
    fixture,
    queueService,
  );

  const [before] = await sql<{
    first_name: string;
    first_auto_close_at: Date;
    second_starts_at: Date;
    second_auto_close_at: Date;
  }[]>`
    SELECT
      first_event.name AS first_name,
      first_event.auto_close_at AS first_auto_close_at,
      second_event.starts_at AS second_starts_at,
      second_event.auto_close_at AS second_auto_close_at
    FROM public.events first_event
    CROSS JOIN public.events second_event
    WHERE first_event.id = ${fixture.eventId}
      AND second_event.id = ${fixture.secondEventId}
  `;
  assert.ok(before);

  const updatedCloseAt = new Date(
    before.second_auto_close_at.getTime() + 30 * 60 * 1_000,
  );
  await eventService.updateDashboardOrganizationEventAutoCloseAtForAuthUser({
    authUserId: fixture.authUserId,
    organizationId: fixture.organizationId,
    eventId: fixture.secondEventPublicId,
    event: { autoCloseAt: updatedCloseAt },
  });
  await eventService.updateDashboardOrganizationEventDetailsForAuthUser({
    authUserId: fixture.authUserId,
    organizationId: fixture.organizationId,
    eventId: fixture.secondEventPublicId,
    event: {
      title: "Second event updated",
      venue: null,
      city: null,
      slug: null,
      visibility: "private",
      startsAt: before.second_starts_at,
      autoCloseAt: updatedCloseAt,
      facebookUrl: null,
      songRequestsEnabled: true,
      publicQueueEnabled: true,
      publicShowSongTitles: true,
      isActivePublicEvent: true,
    },
  });
  await eventService.extendDashboardOrganizationEventForAuthUser({
    authUserId: fixture.authUserId,
    organizationId: fixture.organizationId,
    eventId: fixture.secondEventPublicId,
    extension: { minutes: 20, closesAt: null },
  });
  await eventService.closeDashboardOrganizationEventForAuthUser({
    authUserId: fixture.authUserId,
    organizationId: fixture.organizationId,
    eventId: fixture.secondEventPublicId,
  });

  const [after] = await sql<{
    first_name: string;
    first_status: string;
    first_active: boolean;
    first_auto_close_at: Date;
    second_name: string;
    second_status: string;
    second_active: boolean;
    wrong_event_audits: number;
    second_event_audits: number;
  }[]>`
    SELECT
      first_event.name AS first_name,
      first_event.status::text AS first_status,
      first_event.is_active_public_event AS first_active,
      first_event.auto_close_at AS first_auto_close_at,
      second_event.name AS second_name,
      second_event.status::text AS second_status,
      second_event.is_active_public_event AS second_active,
      (
        SELECT count(*)::integer
        FROM public.operator_audit_log
        WHERE event_id = ${fixture.eventId}
          AND action IN (
            'event_queue_approve',
            'update_event_auto_close_at',
            'update_dashboard_event_details',
            'event.extend',
            'close_dashboard_event'
          )
      ) AS wrong_event_audits,
      (
        SELECT count(*)::integer
        FROM public.operator_audit_log
        WHERE event_id = ${fixture.secondEventId}
          AND action IN (
            'event_queue_approve',
            'update_event_auto_close_at',
            'update_dashboard_event_details',
            'event.extend',
            'close_dashboard_event'
          )
      ) AS second_event_audits
    FROM public.events first_event
    CROSS JOIN public.events second_event
    WHERE first_event.id = ${fixture.eventId}
      AND second_event.id = ${fixture.secondEventId}
  `;
  assert.deepEqual(after, {
    first_name: before.first_name,
    first_status: "active",
    first_active: true,
    first_auto_close_at: before.first_auto_close_at,
    second_name: "Second event updated",
    second_status: "closed",
    second_active: false,
    wrong_event_audits: 0,
    second_event_audits: 5,
  });
}

async function assertQueueRbacRecheckAfterEventLock(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  sql: postgres.Sql,
  fixture: Fixture,
  queueService: typeof import("../../src/server/operator-api/event-queue.ts"),
) {
  const blocker = createPostgresTestClient(harness, "postgres", 1);
  const locked = deferred<number>();
  const release = deferred<void>();
  const heldLock = blocker.begin(async (transaction) => {
    const [backend] = await transaction<{ pid: number }[]>`
      SELECT pg_backend_pid()::integer AS pid
    `;
    assert.ok(backend);
    await transaction`
      SELECT id
      FROM public.events
      WHERE id = ${fixture.secondEventId}
      FOR UPDATE
    `;
    locked.resolve(backend.pid);
    await release.promise;
  });
  void heldLock.catch(() => undefined);

  try {
    const blockerPid = await withDeadline(
      locked.promise,
      "Event lock was not acquired.",
    );
    const attempt =
      queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId: fixture.secondEventPublicId,
        requestId: fixture.secondRequestId,
        action: "reject",
      });
    void attempt.catch(() => undefined);

    await waitForBlockedApplicationQuery(sql, blockerPid);
    await sql`
      UPDATE public.workspace_members
      SET active = false
      WHERE id = ${fixture.membershipId}
    `;
    release.resolve();

    await assert.rejects(
      attempt,
      (error: unknown) =>
        getErrorStatus(error) === 403 &&
        getErrorCode(error) === "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN",
    );
    const [request] = await sql<{ status: string }[]>`
      SELECT status::text
      FROM public.song_requests
      WHERE id = ${fixture.secondRequestId}
    `;
    assert.equal(request.status, "approved");
  } finally {
    release.resolve();
    await heldLock;
    await sql`
      UPDATE public.workspace_members
      SET active = true
      WHERE id = ${fixture.membershipId}
    `;
    await blocker.end({ timeout: 5 });
  }
}

async function waitForBlockedApplicationQuery(
  sql: postgres.Sql,
  blockerPid: number,
) {
  await withDeadline(
    (async () => {
      while (true) {
        const [state] = await sql<{ blocked: number }[]>`
          SELECT count(*)::integer AS blocked
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND ${blockerPid} = ANY(pg_blocking_pids(pid))
        `;
        if (state.blocked > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    })(),
    "Event-scoped mutation did not block on the event row.",
  );
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
      eventId: fixture.eventPublicId,
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

function makePublicToken() {
  return Buffer.from(randomUUID().replaceAll("-", "").slice(0, 16))
    .toString("base64url")
    .slice(0, 22);
}

function clearApplicationDatabase() {
  delete (
    globalThis as typeof globalThis & {
      pozaNutaDatabase?: unknown;
    }
  ).pozaNutaDatabase;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withDeadline<T>(promise: Promise<T>, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 5_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
