import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type postgres from "postgres";
import { test, vi } from "vitest";

import {
  applyPostgresMigration,
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
    const legacyFixture = await seedLegacyActiveEvent(sql);
    const legacyBefore = await eventDataFingerprint(sql, legacyFixture.workspaceId);
    await assertMigrationFailFast(sql);
    await applyPostgresMigration(sql, 22);
    await applyPostgresMigration(sql, 23);
    assert.deepEqual(
      await eventDataFingerprint(sql, legacyFixture.workspaceId),
      legacyBefore,
    );
    const fixture = await seedFixture(sql);
    process.env.DATABASE_URL = makeDatabaseUrl(harness);

    const sessionService = await import("../../src/server/session-api/service.ts");
    const queueService = await import("../../src/server/operator-api/event-queue.ts");
    const eventService = await import(
      "../../src/server/operator-api/organizations.ts"
    );
    const { getDb } = await import("../../src/server/db.ts");
    applicationDatabase = getDb() as unknown as typeof applicationDatabase;

    await assertLegacyActiveEventDoesNotBlockCreate(
      sql,
      legacyFixture,
      eventService,
    );

    await assertConcurrentMultiActiveLifecycle(
      harness,
      sql,
      fixture,
      sessionService,
      queueService,
      eventService,
    );

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

    const joinedGuest = await sessionService.joinPublicSession(
      fixture.publicToken,
      null,
      {
        displayName: "Guest Evidence",
        normalizedDisplayName: "guest evidence",
      },
    );
    const concurrent = await Promise.allSettled([
      sessionService.createPublicSessionRequest(
        fixture.publicToken,
        joinedGuest.credential,
        { songId: fixture.songId },
      ),
      sessionService.createPublicSessionRequest(
        fixture.publicToken,
        joinedGuest.credential,
        { songId: fixture.songId },
      ),
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
      sessionService.createPublicSessionRequest(
        fixture.publicToken,
        joinedGuest.credential,
        { songId: fixture.songId },
      ),
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
      sessionService.createPublicSessionRequest(
        fixture.publicToken,
        joinedGuest.credential,
        { songId: fixture.songId },
      ),
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
  publicToken: string;
};

type LegacyFixture = {
  authUserId: string;
  organizationId: string;
  workspaceId: number;
  eventId: number;
};

async function seedLegacyActiveEvent(sql: postgres.Sql): Promise<LegacyFixture> {
  const authUserId = randomUUID();
  const organizationId = "legacyactiveevent000";
  await sql`INSERT INTO auth.users (id) VALUES (${authUserId})`;
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Legacy active event', 'legacy-active-event', ${organizationId})
    RETURNING id::integer
  `;
  const [operator] = await sql<{ id: number }[]>`
    INSERT INTO public.operator_users (
      name, display_name, profile_completed_at, auth_user_id, password_hash
    )
    VALUES ('legacy_active_operator', 'Legacy Operator', now(), ${authUserId}, 'test-only')
    RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.workspace_members (workspace_id, operator_user_id, role)
    VALUES (${workspace.id}, ${operator.id}, 'owner')
  `;
  const [event] = await sql<{ id: number; session_code: string }[]>`
    INSERT INTO public.events (
      workspace_id, name, starts_at, ends_at, auto_close_at, status,
      is_active_public_event, song_requests_enabled, public_queue_enabled
    )
    VALUES (
      ${workspace.id}, 'Saved active event', now() - interval '1 hour',
      now() + interval '2 hours', now() + interval '2 hours', 'active', true,
      true, true
    )
    RETURNING id::integer, session_code
  `;
  const [session] = await sql<{ id: number }[]>`
    INSERT INTO public.event_sessions (event_id, public_token)
    VALUES (${event.id}, ${makePublicToken()})
    RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
    VALUES (${session.id}, ${event.session_code}, 'initial')
  `;
  return {
    authUserId,
    organizationId,
    workspaceId: workspace.id,
    eventId: event.id,
  };
}

async function assertMigrationFailFast(sql: postgres.Sql) {
  await sql`DROP INDEX public.events_one_active_public_per_workspace_idx`;
  await sql`
    CREATE INDEX events_one_active_public_per_workspace_idx
    ON public.events USING btree (workspace_id)
    WHERE is_active_public_event = true
  `;
  await assert.rejects(
    applyPostgresMigration(sql, 22),
    (error: unknown) =>
      isPostgresError(
        error,
        "23514",
        "events_one_active_public_per_workspace_idx_contract",
      ),
  );
  const [unchanged] = await sql<{ exists: boolean; unique: boolean }[]>`
    SELECT
      to_regclass('public.events_one_active_public_per_workspace_idx') IS NOT NULL AS exists,
      i.indisunique AS unique
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.oid = 'public.events_one_active_public_per_workspace_idx'::regclass
  `;
  assert.deepEqual(unchanged, { exists: true, unique: false });
  await sql`DROP INDEX public.events_one_active_public_per_workspace_idx`;
  await sql`
    CREATE UNIQUE INDEX events_one_active_public_per_workspace_idx
    ON public.events USING btree (workspace_id)
    WHERE is_active_public_event = true
  `;
}

async function assertLegacyActiveEventDoesNotBlockCreate(
  sql: postgres.Sql,
  fixture: LegacyFixture,
  eventService: typeof import("../../src/server/operator-api/organizations.ts"),
) {
  const startsAt = new Date(Date.now() - 60_000);
  const autoCloseAt = new Date(Date.now() + 2 * 60 * 60 * 1_000);
  const created = await eventService.createDashboardOrganizationEventForAuthUser({
    authUserId: fixture.authUserId,
    organizationId: fixture.organizationId,
    event: {
      title: "New event beside legacy active",
      venue: null,
      city: null,
      slug: null,
      visibility: "private",
      startsAt,
      autoCloseAt,
      facebookUrl: null,
      songRequestsEnabled: true,
      publicQueueEnabled: true,
      publicShowSongTitles: false,
      isActivePublicEvent: true,
    },
  });
  assert.notEqual(created.event.id, fixture.eventId);
  const [state] = await sql<{
    active: number;
    sessions: number;
    tokens: number;
    codes: number;
  }[]>`
    SELECT
      count(*) FILTER (WHERE e.is_active_public_event)::integer AS active,
      count(s.id)::integer AS sessions,
      count(DISTINCT s.public_token)::integer AS tokens,
      count(DISTINCT c.code)::integer AS codes
    FROM public.events e
    JOIN public.event_sessions s ON s.event_id = e.id
    JOIN public.event_session_codes c
      ON c.session_id = s.id
     AND c.valid_until IS NULL
     AND c.revoked_at IS NULL
    WHERE e.workspace_id = ${fixture.workspaceId}
  `;
  assert.deepEqual(state, { active: 2, sessions: 2, tokens: 2, codes: 2 });
}

async function eventDataFingerprint(sql: postgres.Sql, workspaceId: number) {
  const [state] = await sql<{ count: number; fingerprint: string | null }[]>`
    SELECT
      count(*)::integer AS count,
      md5(string_agg(
        row_to_json(event_row)::text,
        ',' ORDER BY event_row.id
      )) AS fingerprint
    FROM (
      SELECT *
      FROM public.events
      WHERE workspace_id = ${workspaceId}
    ) AS event_row
  `;
  return state;
}

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
  const [session] = await sql<{ id: number; public_token: string }[]>`
    INSERT INTO public.event_sessions (event_id, public_token)
    VALUES (${event.id}, ${makePublicToken()})
    RETURNING id::integer, public_token
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
    publicToken: session.public_token,
  };
}

async function assertConcurrentMultiActiveLifecycle(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  sql: postgres.Sql,
  fixture: Fixture,
  sessionService: typeof import("../../src/server/session-api/service.ts"),
  queueService: typeof import("../../src/server/operator-api/event-queue.ts"),
  eventService: typeof import("../../src/server/operator-api/organizations.ts"),
) {
  await sql`
    CREATE FUNCTION public.block_0022_event_activation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.is_active_public_event THEN
          PERFORM pg_advisory_xact_lock(2200022);
        END IF;
      ELSIF NEW.is_active_public_event AND NOT OLD.is_active_public_event THEN
        PERFORM pg_advisory_xact_lock(2200022);
      END IF;
      RETURN NEW;
    END
    $$
  `;
  await sql`
    CREATE TRIGGER block_0022_event_activation
    BEFORE INSERT OR UPDATE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.block_0022_event_activation()
  `;

  try {
    const startsAt = new Date(Date.now() - 60_000);
    const autoCloseAt = new Date(Date.now() + 2 * 60 * 60 * 1_000);
    const createResults = await runBlockedActivationRace(
      harness,
      sql,
      ["Concurrent event A", "Concurrent event B"].map((title) => () =>
        eventService.createDashboardOrganizationEventForAuthUser({
          authUserId: fixture.authUserId,
          organizationId: fixture.organizationId,
          event: {
            title,
            venue: null,
            city: null,
            slug: null,
            visibility: "private",
            startsAt,
            autoCloseAt,
            facebookUrl: null,
            songRequestsEnabled: true,
            publicQueueEnabled: true,
            publicShowSongTitles: true,
            isActivePublicEvent: true,
          },
        }),
      ),
    );
    assert.equal(createResults[0]?.status, "fulfilled");
    assert.equal(createResults[1]?.status, "fulfilled");
    if (
      createResults[0]?.status !== "fulfilled" ||
      createResults[1]?.status !== "fulfilled"
    ) {
      assert.fail("Both concurrent event creations must succeed.");
    }

    const createdEvents = [
      createResults[0].value.event,
      createResults[1].value.event,
    ];
    const createdIds = createdEvents.map(({ id }) => id);
    assert.equal(new Set(createdIds).size, 2);
    assert.equal(
      new Set(createdEvents.map(({ publicId }) => publicId)).size,
      2,
    );
    assert.equal(createdEvents.every(({ isActivePublicEvent }) => isActivePublicEvent), true);

    const identities = await sql<{
      event_id: number;
      session_code: string;
      public_token: string;
    }[]>`
      SELECT
        e.id::integer AS event_id,
        e.session_code,
        s.public_token
      FROM public.events e
      JOIN public.event_sessions s ON s.event_id = e.id
      WHERE e.id = ANY(${createdIds})
      ORDER BY e.id
    `;
    assert.equal(identities.length, 2);
    assert.equal(new Set(identities.map(({ session_code }) => session_code)).size, 2);
    assert.equal(new Set(identities.map(({ public_token }) => public_token)).size, 2);

    const [activeState] = await sql<{ active: number }[]>`
      SELECT count(*)::integer AS active
      FROM public.events
      WHERE workspace_id = ${fixture.workspaceId}
        AND is_active_public_event
    `;
    assert.equal(activeState.active, 4);

    await Promise.all(
      identities.map(async ({ public_token }, index) => {
        const displayName = `Scoped Guest ${index + 1}`;
        const joined = await sessionService.joinPublicSession(
          public_token,
          null,
          {
            displayName,
            normalizedDisplayName: displayName.toLocaleLowerCase("pl-PL"),
          },
        );
        return sessionService.createPublicSessionRequest(
          public_token,
          joined.credential,
          { songId: fixture.songId },
        );
      }),
    );
    const requests = await sql<{ id: number; event_id: number; status: string }[]>`
      SELECT id::integer, event_id::integer, status::text
      FROM public.song_requests
      WHERE event_id = ANY(${createdIds})
      ORDER BY event_id
    `;
    assert.equal(requests.length, 2);
    assert.deepEqual(
      new Set(requests.map(({ event_id }) => event_id)),
      new Set(createdIds),
    );

    const queues = await Promise.all(
      createdEvents.map(({ publicId }) =>
        queueService.getDashboardOrganizationEventQueueForAuthUser({
          authUserId: fixture.authUserId,
          organizationId: fixture.organizationId,
          eventId: publicId,
        }),
      ),
    );
    assert.deepEqual(
      queues.map((queue) => queue?.items.length),
      [1, 1],
    );
    await assert.rejects(
      queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId: createdEvents[0].publicId,
        requestId: requests.find(({ event_id }) => event_id === createdIds[1])!.id,
        action: "approve",
      }),
      (error: unknown) =>
        getErrorStatus(error) === 404 &&
        getErrorCode(error) === "REQUEST_NOT_FOUND",
    );

    await Promise.all(
      createdEvents.map(({ publicId }) =>
        eventService.closeDashboardOrganizationEventForAuthUser({
          authUserId: fixture.authUserId,
          organizationId: fixture.organizationId,
          eventId: publicId,
        }),
      ),
    );
    const reopenedAt = new Date(Date.now() + 3 * 60 * 60 * 1_000);
    const reopenResults = await runBlockedActivationRace(
      harness,
      sql,
      createdEvents.map(({ publicId }) => () =>
        eventService.reopenDashboardOrganizationEventForAuthUser({
          authUserId: fixture.authUserId,
          organizationId: fixture.organizationId,
          eventId: publicId,
          extension: { minutes: null, closesAt: reopenedAt },
        }),
      ),
    );
    assert.equal(reopenResults[0]?.status, "fulfilled");
    assert.equal(reopenResults[1]?.status, "fulfilled");

    const [reopenedState] = await sql<{ active: number; audits: number }[]>`
      SELECT
        count(*) FILTER (WHERE is_active_public_event)::integer AS active,
        (
          SELECT count(*)::integer
          FROM public.operator_audit_log
          WHERE event_id = ANY(${createdIds})
            AND action = 'event.reopen'
        ) AS audits
      FROM public.events
      WHERE id = ANY(${createdIds})
    `;
    assert.deepEqual(reopenedState, { active: 2, audits: 2 });
  } finally {
    await sql`DROP TRIGGER IF EXISTS block_0022_event_activation ON public.events`;
    await sql`DROP FUNCTION IF EXISTS public.block_0022_event_activation()`;
  }
}

async function runBlockedActivationRace<T>(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  observer: postgres.Sql,
  operations: Array<() => Promise<T>>,
) {
  const blocker = createPostgresTestClient(harness, "postgres", 1);
  const blockerReady = deferred<number>();
  const releaseBlocker = deferred<void>();
  const heldLock = blocker.begin(async (transaction) => {
    const [backend] = await transaction<{ pid: number }[]>`
      SELECT pg_backend_pid()::integer AS pid
    `;
    assert.ok(backend);
    await transaction`SELECT pg_advisory_xact_lock(2200022)`;
    blockerReady.resolve(backend.pid);
    await releaseBlocker.promise;
  });
  void heldLock.catch(() => undefined);
  const attempts: Array<Promise<T>> = [];

  try {
    const blockerPid = await withDeadline(
      blockerReady.promise,
      "Activation barrier was not acquired.",
    );
    attempts.push(...operations.map((operation) => operation()));
    for (const attempt of attempts) void attempt.catch(() => undefined);
    await waitForBlockedApplicationQuery(observer, blockerPid, operations.length);
    releaseBlocker.resolve();
    return await Promise.allSettled(attempts);
  } finally {
    releaseBlocker.resolve();
    await Promise.allSettled([heldLock, ...attempts]);
    await blocker.end({ timeout: 5 });
  }
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
  minimumBlocked = 1,
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
        if (state.blocked >= minimumBlocked) return;
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

function requireId(ids: Map<string, number>, name: string) {
  const id = ids.get(name);
  assert.ok(id);
  return id;
}
