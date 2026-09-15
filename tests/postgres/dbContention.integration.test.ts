import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

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

test("same-event queue mutations wait on the targeted session mutex while a different event completes", async () => {
  const harness = await startPostgresTestHarness("pozanuta-db-contention");
  const observer = createPostgresTestClient(harness, "postgres", 4);
  const previousUrl = process.env.DATABASE_URL;
  let applicationDatabase: { $client: { end(options: { timeout: number }): Promise<void> } } | undefined;

  try {
    await installPostgresCompatibilityFixture(observer);
    await applyPostgresMigrations(observer, 24);
    const fixture = await seedFixture(observer);
    process.env.DATABASE_URL = `postgres://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
    const { getDb } = await import("../../src/server/db.ts");
    const queueService = await import("../../src/server/operator-api/event-queue.ts");
    applicationDatabase = getDb() as unknown as typeof applicationDatabase;

    const blocker = createPostgresTestClient(harness, "postgres", 1);
    const locked = deferred<number>();
    const release = deferred<void>();
    const heldLock = blocker.begin(async (transaction) => {
      const [backend] = await transaction<{ pid: number }[]>`SELECT pg_backend_pid()::integer AS pid`;
      await transaction`SELECT id FROM public.event_sessions WHERE id = ${fixture.firstEvent.sessionId} FOR NO KEY UPDATE`;
      locked.resolve(backend.pid);
      await release.promise;
    });
    void heldLock.catch(() => undefined);
    const attempts: Array<Promise<unknown>> = [];
    const mutate = (eventId: string, requestId: number) => {
      const result = queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId,
        requestId,
        action: "reject",
      });
      void result.catch(() => undefined);
      attempts.push(result);
      return result;
    };

    try {
      const blockerPid = await withDeadline(locked.promise, "Session queue mutex was not acquired.");
      const sameA = mutate(fixture.firstEvent.publicId, fixture.firstEvent.requestIds[0]);
      await waitForBlockedQuery(observer, blockerPid, 1);
      const different = mutate(fixture.secondEvent.publicId, fixture.secondEvent.requestIds[0]);
      const differentResult = await withDeadline(different, "Different-event mutation waited behind the first session mutex.");
      assert.equal(differentResult.request.status, "rejected");
      const sameB = mutate(fixture.firstEvent.publicId, fixture.firstEvent.requestIds[1]);
      await waitForBlockedQuery(observer, blockerPid, 2);
      release.resolve();
      const [firstResult, secondResult] = await Promise.all([sameA, sameB]);
      assert.equal(firstResult.request.status, "rejected");
      assert.equal(secondResult.request.status, "rejected");
    } finally {
      release.resolve();
      await Promise.allSettled([heldLock, ...attempts]);
      await blocker.end({ timeout: 5 });
    }

    const [state] = await observer<{ rejected: number; audits: number }[]>`
      SELECT
        count(*) FILTER (WHERE status = 'rejected')::integer AS rejected,
        (SELECT count(*)::integer FROM public.operator_audit_log WHERE action = 'event_queue_reject') AS audits
      FROM public.song_requests
      WHERE event_id IN (${fixture.firstEvent.id}, ${fixture.secondEvent.id})
    `;
    assert.deepEqual(state, { rejected: 3, audits: 3 });
  } finally {
    if (applicationDatabase) {
      await applicationDatabase.$client.end({ timeout: 5 });
      delete (globalThis as typeof globalThis & { pozaNutaDatabase?: unknown }).pozaNutaDatabase;
    }
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await observer.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
}, 180_000);

test("participation avoids the queue mutex while public create and operator queue mutations serialize", async () => {
  const harness = await startPostgresTestHarness("pozanuta-public-lock-scope");
  const observer = createPostgresTestClient(harness, "postgres", 4);
  const previousUrl = process.env.DATABASE_URL;
  const originalInfo = console.info;
  const telemetry: Array<Record<string, unknown>> = [];
  let applicationDatabase: { $client: { end(options: { timeout: number }): Promise<void> } } | undefined;

  try {
    await installPostgresCompatibilityFixture(observer);
    await applyPostgresMigrations(observer, 24);
    const fixture = await seedFixture(observer);
    process.env.DATABASE_URL = `postgres://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
    const { getDb } = await import("../../src/server/db.ts");
    const sessionService = await import("../../src/server/session-api/service.ts");
    const queueService = await import("../../src/server/operator-api/event-queue.ts");
    applicationDatabase = getDb() as unknown as typeof applicationDatabase;
    console.info = (message?: unknown) => {
      if (typeof message === "string" && message.startsWith('{"event":"db_telemetry"')) {
        telemetry.push(JSON.parse(message) as Record<string, unknown>);
      } else {
        originalInfo(message);
      }
    };

    const join = (publicToken: string, name: string) =>
      sessionService.joinPublicSession(publicToken, null, {
        displayName: name,
        normalizedDisplayName: name.toLowerCase(),
      });

    let joinedCredential = "";
    await withHeldRowLock(harness, "events", fixture.firstEvent.id, async (blockerPid, release, track) => {
      const sameEvent = track(join(fixture.firstEvent.publicToken, "Event lock evidence"));
      const waiterPid = await waitForDirectWaiter(observer, blockerPid, "Lifecycle guard did not wait for the event row.");
      const [waiting] = await observer<{ query: string }[]>`SELECT query FROM pg_stat_activity WHERE pid = ${waiterPid}`;
      assert.match(waiting.query.toLowerCase(), /from "events".*for share/s);
      assert.doesNotMatch(waiting.query.toLowerCase(), /join "event_sessions"/);
      const lifecycleRequestId = latestOperationRequestId(telemetry, "public_session.lifecycle.guard", "start");
      assert.ok(telemetry.some((entry) => entry.request_id === lifecycleRequestId && entry.operation === "public_session.lookup" && entry.phase === "success"));
      const differentEvent = await withDeadline(
        track(join(fixture.secondEvent.publicToken, "Event control evidence")),
        "Different-event public mutation waited for the first event row.",
      );
      assert.equal(differentEvent.participant.displayName, "Event control evidence");
      release();
      const joined = await withDeadline(sameEvent, "Lifecycle-guarded join did not complete.");
      assert.equal(joined.participant.displayName, "Event lock evidence");
      joinedCredential = joined.credential;
    });

    await withHeldRowLock(harness, "event_sessions", fixture.firstEvent.sessionId, async (blockerPid, release, track) => {
      const sameSession = track(sessionService.joinPublicSession(fixture.firstEvent.publicToken, joinedCredential, {
        displayName: "Ignored existing nickname",
        normalizedDisplayName: "ignored existing nickname",
      }));
      const existing = await withDeadline(sameSession, "Existing participant waited on the session row.");
      assert.equal(existing.participant.displayName, "Event lock evidence");
      const renamed = await withDeadline(track(sessionService.renamePublicSessionParticipant(
        fixture.firstEvent.publicToken,
        joinedCredential,
        { displayName: "Renamed lock evidence", normalizedDisplayName: "renamed lock evidence" },
      )), "Participant rename waited on the session row.");
      assert.equal(renamed.displayName, "Renamed lock evidence");
      const differentSession = await withDeadline(
        track(join(fixture.secondEvent.publicToken, "Session control evidence")),
        "Different-session public mutation waited for the first session row.",
      );
      assert.equal(differentSession.participant.displayName, "Session control evidence");
      release();
    });
    await withHeldRowLock(harness, "event_sessions", fixture.firstEvent.sessionId, async (_blockerPid, release, track) => {
      const newParticipant = await withDeadline(
        track(join(fixture.firstEvent.publicToken, "Compatible session lock")),
        "New participant waited on a non-key session lock.",
      );
      assert.equal(newParticipant.participant.displayName, "Compatible session lock");
      release();
    }, "no key update");

    let publicQueueMutexMs = 0;
    let operatorRequestSelectMs = 0;
    await withHeldRowLock(harness, "song_requests", fixture.firstEvent.requestIds[0], async (blockerPid, release, track) => {
      const operator = track(queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId: fixture.firstEvent.publicId,
        requestId: fixture.firstEvent.requestIds[0],
        action: "reject",
      }));
      const operatorPid = await waitForDirectWaiter(observer, blockerPid, "Operator did not wait for the held request row.");
      const operatorRequestId = latestStartRequestId(telemetry, "operator.queue_request.lock");
      assert.ok(telemetry.some((entry) => entry.request_id === operatorRequestId && entry.operation === "operator.queue_mutex.lock" && entry.phase === "lock_acquired"));

      const differentOperator = await withDeadline(track(queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId: fixture.secondEvent.publicId,
        requestId: fixture.secondEvent.requestIds[0],
        action: "reject",
      })), "Different-event operator mutation waited for the first event.");
      assert.equal(differentOperator.request.status, "rejected");
      const differentPublic = await withDeadline(
        track(join(fixture.secondEvent.publicToken, "Cross event control")),
        "Different-event public mutation waited for the first event.",
      );
      assert.equal(differentPublic.participant.displayName, "Cross event control");
      const differentPublicCreate = await withDeadline(track(sessionService.createPublicSessionRequest(
        fixture.secondEvent.publicToken,
        differentPublic.credential,
        { songId: fixture.songId },
      )), "Different-event public create waited for the first event queue.");
      assert.equal(differentPublicCreate.status, "pending");

      const publicParticipant = await withDeadline(track(join(fixture.firstEvent.publicToken, "Public operator evidence")),
        "Join waited behind the operator's queue mutex.");
      assert.equal(publicParticipant.participant.displayName, "Public operator evidence");
      const publicCreate = track(sessionService.createPublicSessionRequest(
        fixture.firstEvent.publicToken,
        publicParticipant.credential,
        { songId: fixture.songId },
      ));
      const queueWaiterPid = await waitForDirectWaiter(observer, operatorPid, "Public create did not wait for the operator's session queue mutex.");
      const [queueWaiting] = await observer<{ query: string }[]>`SELECT query FROM pg_stat_activity WHERE pid = ${queueWaiterPid}`;
      assert.match(queueWaiting.query.toLowerCase(), /from "event_sessions".*for no key update/s);
      const publicRequestId = latestStartRequestId(telemetry, "public_session.queue_mutex.lock");
      release();
      const [operatorResult, publicResult] = await Promise.all([
        withDeadline(operator, "Operator mutation did not finish after release."),
        withDeadline(publicCreate, "Public create did not finish after release."),
      ]);
      assert.equal(operatorResult.request.status, "rejected");
      assert.equal(publicResult.status, "pending");
      operatorRequestSelectMs = acquiredSelectMs(telemetry, operatorRequestId, "operator.queue_request.lock");
      publicQueueMutexMs = acquiredSelectMs(telemetry, publicRequestId, "public_session.queue_mutex.lock");
    });

    console.log(JSON.stringify({
      evidence: "targeted_queue_mutex_scope",
      public_queue_mutex_for_update_select_ms: publicQueueMutexMs,
      operator_request_for_update_select_ms: operatorRequestSelectMs,
    }));
  } finally {
    console.info = originalInfo;
    if (applicationDatabase) {
      await applicationDatabase.$client.end({ timeout: 5 });
      delete (globalThis as typeof globalThis & { pozaNutaDatabase?: unknown }).pozaNutaDatabase;
    }
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await observer.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
}, 180_000);

test("public request races preserve current participant names, active uniqueness, and cancel/operator outcomes", async () => {
  const harness = await startPostgresTestHarness("pozanuta-queue-races");
  const observer = createPostgresTestClient(harness, "postgres", 4);
  const previousUrl = process.env.DATABASE_URL;
  let applicationDatabase: { $client: { end(options: { timeout: number }): Promise<void> } } | undefined;

  try {
    await installPostgresCompatibilityFixture(observer);
    await applyPostgresMigrations(observer, 24);
    const fixture = await seedFixture(observer);
    process.env.DATABASE_URL = `postgres://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
    const { getDb } = await import("../../src/server/db.ts");
    const sessionService = await import("../../src/server/session-api/service.ts");
    const queueService = await import("../../src/server/operator-api/event-queue.ts");
    applicationDatabase = getDb() as unknown as typeof applicationDatabase;

    const join = (name: string) => sessionService.joinPublicSession(fixture.firstEvent.publicToken, null, {
      displayName: name,
      normalizedDisplayName: name.toLowerCase(),
    });
    const create = (credential: string) => sessionService.createPublicSessionRequest(
      fixture.firstEvent.publicToken, credential, { songId: fixture.songId },
    );

    const [firstParticipant, secondParticipant] = await Promise.all([
      join("Position Race One"), join("Position Race Two"),
    ]);
    const [firstRequest, secondRequest] = await withDeadline(Promise.all([
      create(firstParticipant.credential), create(secondParticipant.credential),
    ]), "Concurrent public creates did not resolve.");
    const positions = await observer<{ id: number; position: number; status: string }[]>`
      SELECT id::integer, position::integer, status::text
      FROM public.song_requests
      WHERE public_id IN (${firstRequest.id}::uuid, ${secondRequest.id}::uuid)
      ORDER BY id
    `;
    assert.equal(positions.length, 2);
    assert.deepEqual(positions.map(({ position }) => position), [1, 2]);
    assert.deepEqual(positions.map(({ status }) => status), ["pending", "pending"]);
    assert.equal(new Set(positions.map(({ position }) => position)).size, 2);

    const staleNameParticipant = await join("Name Before Rename");
    const nameBlocker = await holdRowLock(
      harness,
      "event_sessions",
      fixture.firstEvent.sessionId,
      "no key update",
    );
    let nameCreate: ReturnType<typeof create> | undefined;
    try {
      nameCreate = create(staleNameParticipant.credential);
      void nameCreate.catch(() => undefined);
      await waitForDirectWaiter(
        observer,
        nameBlocker.pid,
        "Create did not reach the session mutex after its initial participant lookup.",
        /from "event_sessions".*for no key update/is,
      );
      const renamed = await withDeadline(
        sessionService.renamePublicSessionParticipant(
          fixture.firstEvent.publicToken,
          staleNameParticipant.credential,
          {
            displayName: "Name After Rename",
            normalizedDisplayName: "name after rename",
          },
        ),
        "Rename did not commit while create was held at the session mutex.",
      );
      assert.equal(renamed.displayName, "Name After Rename");
      nameBlocker.release();
      const created = await withDeadline(
        nameCreate,
        "Create did not finish after the session mutex was released.",
      );
      const [storedName] = await observer<{ singer_name: string; display_name: string }[]>`
        SELECT singer_name, display_name
        FROM public.song_requests
        WHERE public_id = ${created.id}::uuid
      `;
      assert.deepEqual(storedName, {
        singer_name: "Name After Rename",
        display_name: "Name After Rename",
      });
    } finally {
      nameBlocker.release();
      if (nameCreate) await Promise.allSettled([nameCreate]);
      await nameBlocker.close();
    }

    const joinBlocker = await holdRowLock(
      harness,
      "events",
      fixture.firstEvent.id,
    );
    let existingJoin: ReturnType<typeof sessionService.joinPublicSession> | undefined;
    let joinRename: ReturnType<typeof sessionService.renamePublicSessionParticipant> | undefined;
    try {
      existingJoin = sessionService.joinPublicSession(
        fixture.firstEvent.publicToken,
        staleNameParticipant.credential,
        {
          displayName: "Ignored Existing Name",
          normalizedDisplayName: "ignored existing name",
        },
      );
      void existingJoin.catch(() => undefined);
      await waitForDirectWaiter(
        observer,
        joinBlocker.pid,
        "Existing-participant join did not reach the lifecycle guard.",
        /from "events".*for share/is,
      );
      joinRename = sessionService.renamePublicSessionParticipant(
        fixture.firstEvent.publicToken,
        staleNameParticipant.credential,
        {
          displayName: "Name Returned By Join",
          normalizedDisplayName: "name returned by join",
        },
      );
      void joinRename.catch(() => undefined);
      await waitForBlockedQuery(observer, joinBlocker.pid, 2, /from "events".*for share/is);
      joinBlocker.release();
      const [joinedAgain, renamedAgain] = await withDeadline(
        Promise.all([existingJoin, joinRename]),
        "Join/rename overlap did not resolve after the lifecycle lock was released.",
      );
      assert.equal(renamedAgain.displayName, "Name Returned By Join");
      assert.equal(joinedAgain.participant.displayName, "Name Returned By Join");
    } finally {
      joinBlocker.release();
      await Promise.allSettled([
        ...(existingJoin ? [existingJoin] : []),
        ...(joinRename ? [joinRename] : []),
      ]);
      await joinBlocker.close();
    }

    const duplicateParticipant = await join("Duplicate Race");
    const [beforeDuplicate] = await observer<{ max_position: number }[]>`
      SELECT coalesce(max(position), 0)::integer AS max_position
      FROM public.song_requests
      WHERE event_id = ${fixture.firstEvent.id}
    `;
    const duplicateBlocker = await holdRowLock(
      harness,
      "event_sessions",
      fixture.firstEvent.sessionId,
      "no key update",
    );
    const duplicateAttempts = [
      create(duplicateParticipant.credential),
      create(duplicateParticipant.credential),
    ];
    for (const attempt of duplicateAttempts) void attempt.catch(() => undefined);
    let duplicateRace: PromiseSettledResult<Awaited<ReturnType<typeof create>>>[] = [];
    try {
      await waitForBlockedQuery(
        observer,
        duplicateBlocker.pid,
        2,
        /from "event_sessions".*for no key update/is,
      );
      duplicateBlocker.release();
      duplicateRace = await withDeadline(
        Promise.allSettled(duplicateAttempts),
        "Concurrent duplicate creates did not resolve.",
      );
    } finally {
      duplicateBlocker.release();
      await Promise.allSettled(duplicateAttempts);
      await duplicateBlocker.close();
    }
    const duplicateWinner = duplicateRace.find((result) => result.status === "fulfilled");
    const duplicateLoser = duplicateRace.find((result) => result.status === "rejected");
    assert.ok(duplicateWinner?.status === "fulfilled");
    assert.ok(duplicateLoser?.status === "rejected");
    assert.equal(duplicateLoser.reason.status, 409);
    assert.equal(duplicateLoser.reason.code, "SESSION_REQUEST_DUPLICATE");
    const [duplicateState] = await observer<{ active: number; positions: number; max_position: number }[]>`
      SELECT
        count(*)::integer AS active,
        count(DISTINCT position)::integer AS positions,
        max(position)::integer AS max_position
      FROM public.song_requests
      WHERE event_id = ${fixture.firstEvent.id}
        AND event_participant_id = (
          SELECT event_participant_id FROM public.song_requests
          WHERE public_id = ${duplicateWinner.value.id}::uuid
        )
        AND song_id = ${fixture.songId}
        AND status IN ('pending', 'approved', 'now')
    `;
    assert.deepEqual(duplicateState, {
      active: 1,
      positions: 1,
      max_position: beforeDuplicate.max_position + 1,
    });

    const cancelParticipant = await join("Cancel Operator Race");
    const independentCancel = await create(cancelParticipant.credential);
    await withHeldRowLock(harness, "event_sessions", fixture.firstEvent.sessionId, async (_blockerPid, release, track) => {
      const cancelled = await withDeadline(track(sessionService.cancelPublicParticipantRequest(
        fixture.firstEvent.publicToken, cancelParticipant.credential, independentCancel.id,
      )), "Cancel waited on the session queue mutex.");
      assert.equal(cancelled.status, "skipped");
      release();
    }, "no key update");
    const cancelWinsRequest = await create(cancelParticipant.credential);
    const [cancelWinsRow] = await observer<{ id: number }[]>`
      SELECT id::integer FROM public.song_requests WHERE public_id = ${cancelWinsRequest.id}::uuid
    `;
    assert.ok(cancelWinsRow);
    const cancelWinsBlocker = await holdRowLock(harness, "song_requests", cancelWinsRow.id);
    const cancelFirst = sessionService.cancelPublicParticipantRequest(
      fixture.firstEvent.publicToken,
      cancelParticipant.credential,
      cancelWinsRequest.id,
    );
    void cancelFirst.catch(() => undefined);
    let operatorSecond: ReturnType<typeof queueService.applyDashboardOrganizationEventQueueActionForAuthUser> | undefined;
    try {
      await waitForDirectWaiter(
        observer,
        cancelWinsBlocker.pid,
        "Cancel did not wait on the held request row.",
        /update "song_requests"/i,
      );
      operatorSecond = queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId: fixture.firstEvent.publicId,
        requestId: cancelWinsRow.id,
        action: "approve",
      });
      void operatorSecond.catch(() => undefined);
      await waitForBlockedQuery(observer, cancelWinsBlocker.pid, 2, /"song_requests"/is);
      cancelWinsBlocker.release();
      const [cancelResult, operatorResult] = await withDeadline(
        Promise.allSettled([cancelFirst, operatorSecond]),
        "Cancel-first race did not resolve.",
      );
      assert.equal(cancelResult.status, "fulfilled");
      assert.equal(operatorResult.status, "rejected");
      if (cancelResult.status === "fulfilled") assert.equal(cancelResult.value.status, "skipped");
      if (operatorResult.status === "rejected") {
        assert.equal(operatorResult.reason.status, 409);
        assert.equal(operatorResult.reason.code, "INVALID_STATUS_TRANSITION");
      }
    } finally {
      cancelWinsBlocker.release();
      await Promise.allSettled([
        cancelFirst,
        ...(operatorSecond ? [operatorSecond] : []),
      ]);
      await cancelWinsBlocker.close();
    }
    const [cancelWinsState] = await observer<{ status: string; version: number; position: number }[]>`
      SELECT status::text, version::integer, position::integer
      FROM public.song_requests WHERE id = ${cancelWinsRow.id}
    `;
    assert.deepEqual(cancelWinsState, { status: "skipped", version: 2, position: 0 });

    const operatorWinsRequest = await create(cancelParticipant.credential);
    const [operatorWinsRow] = await observer<{ id: number }[]>`
      SELECT id::integer FROM public.song_requests WHERE public_id = ${operatorWinsRequest.id}::uuid
    `;
    assert.ok(operatorWinsRow);
    const operatorWinsBlocker = await holdRowLock(harness, "song_requests", operatorWinsRow.id);
    const operatorFirst = queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
      authUserId: fixture.authUserId,
      organizationId: fixture.organizationId,
      eventId: fixture.firstEvent.publicId,
      requestId: operatorWinsRow.id,
      action: "approve",
    });
    void operatorFirst.catch(() => undefined);
    let cancelSecond: ReturnType<typeof sessionService.cancelPublicParticipantRequest> | undefined;
    try {
      await waitForDirectWaiter(
        observer,
        operatorWinsBlocker.pid,
        "Operator action did not wait on the held request row.",
        /from "song_requests".*for update/is,
      );
      cancelSecond = sessionService.cancelPublicParticipantRequest(
        fixture.firstEvent.publicToken,
        cancelParticipant.credential,
        operatorWinsRequest.id,
      );
      void cancelSecond.catch(() => undefined);
      await waitForBlockedQuery(observer, operatorWinsBlocker.pid, 2, /"song_requests"/is);
      operatorWinsBlocker.release();
      const [operatorResult, cancelResult] = await withDeadline(
        Promise.allSettled([operatorFirst, cancelSecond]),
        "Operator-first race did not resolve.",
      );
      assert.equal(operatorResult.status, "fulfilled");
      assert.equal(cancelResult.status, "rejected");
      if (operatorResult.status === "fulfilled") assert.equal(operatorResult.value.request.status, "approved");
      if (cancelResult.status === "rejected") {
        assert.equal(cancelResult.reason.status, 409);
        assert.equal(cancelResult.reason.code, "SESSION_REQUEST_CANNOT_CANCEL");
      }
    } finally {
      operatorWinsBlocker.release();
      await Promise.allSettled([
        operatorFirst,
        ...(cancelSecond ? [cancelSecond] : []),
      ]);
      await operatorWinsBlocker.close();
    }
    const [operatorWinsState] = await observer<{ status: string; version: number; position: number }[]>`
      SELECT status::text, version::integer, position::integer
      FROM public.song_requests WHERE id = ${operatorWinsRow.id}
    `;
    assert.deepEqual(operatorWinsState, { status: "approved", version: 2, position: 1 });
  } finally {
    if (applicationDatabase) {
      await applicationDatabase.$client.end({ timeout: 5 });
      delete (globalThis as typeof globalThis & { pozaNutaDatabase?: unknown }).pozaNutaDatabase;
    }
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await observer.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
}, 180_000);

test("event-without-session fallback serializes identity creation and a later session-mutex operator", async () => {
  const harness = await startPostgresTestHarness("pozanuta-fallback-race");
  const observer = createPostgresTestClient(harness, "postgres", 4);
  const identityWriter = createPostgresTestClient(harness, "postgres", 1);
  const previousUrl = process.env.DATABASE_URL;
  let applicationDatabase: { $client: { end(options: { timeout: number }): Promise<void> } } | undefined;

  try {
    await installPostgresCompatibilityFixture(observer);
    await applyPostgresMigrations(observer, 24);
    const fixture = await seedFixture(observer);
    const [legacyEvent] = await observer<{ id: number; public_id: string }[]>`
      INSERT INTO public.events (
        workspace_id, name, starts_at, ends_at, auto_close_at, status,
        is_active_public_event, song_requests_enabled, public_queue_enabled
      )
      VALUES (
        ${fixture.workspaceId}, 'Fallback race event', now() - interval '1 hour',
        now() + interval '2 hours', now() + interval '2 hours', 'active',
        false, true, true
      )
      RETURNING id::integer, public_id::text
    `;
    const legacyRequests = await observer<{ id: number }[]>`
      INSERT INTO public.song_requests (
        event_id, song_id, singer_name, display_name, status, position, requested_by
      )
      VALUES
        (${legacyEvent.id}, ${fixture.songId}, 'Fallback One', 'Fallback One', 'pending', 0, 'operator'),
        (${legacyEvent.id}, ${fixture.songId}, 'Fallback Two', 'Fallback Two', 'pending', 0, 'operator'),
        (${legacyEvent.id}, ${fixture.songId}, 'Session Mutex Three', 'Session Mutex Three', 'pending', 0, 'operator')
      RETURNING id::integer
    `;
    assert.equal(legacyRequests.length, 3);
    const [before] = await observer<{ sessions: number }[]>`
      SELECT count(*)::integer AS sessions
      FROM public.event_sessions
      WHERE event_id = ${legacyEvent.id}
    `;
    assert.equal(before.sessions, 0);

    process.env.DATABASE_URL = `postgres://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
    const { getDb } = await import("../../src/server/db.ts");
    const queueService = await import("../../src/server/operator-api/event-queue.ts");
    applicationDatabase = getDb() as unknown as typeof applicationDatabase;

    const applyReject = (requestId: number) =>
      queueService.applyDashboardOrganizationEventQueueActionForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.organizationId,
        eventId: legacyEvent.public_id,
        requestId,
        action: "reject",
      });

    const firstRequestBlocker = await holdRowLock(
      harness,
      "song_requests",
      legacyRequests[0].id,
    );
    const secondRequestBlocker = await holdRowLock(
      harness,
      "song_requests",
      legacyRequests[1].id,
    );
    let firstOperator: ReturnType<typeof applyReject> | undefined;
    let staleFallbackOperator: ReturnType<typeof applyReject> | undefined;
    let sessionMutexOperator: ReturnType<typeof applyReject> | undefined;
    let sessionInsert: Promise<unknown> | undefined;

    try {
      firstOperator = applyReject(legacyRequests[0].id);
      void firstOperator.catch(() => undefined);
      const firstOperatorPid = await waitForDirectWaiter(
        observer,
        firstRequestBlocker.pid,
        "Fallback operator did not lock the event before waiting on its request.",
        /from "song_requests".*for update/is,
      );

      sessionInsert = identityWriter.begin(async (transaction) => {
        await transaction`
          INSERT INTO public.event_sessions (event_id, public_token)
          VALUES (${legacyEvent.id}, ${randomBytes(16).toString("base64url")})
        `;
      });
      void sessionInsert.catch(() => undefined);
      await waitForDirectWaiter(
        observer,
        firstOperatorPid,
        "Session identity INSERT did not wait for the fallback event lock.",
        /insert into public\.event_sessions/is,
      );

      staleFallbackOperator = applyReject(legacyRequests[1].id);
      void staleFallbackOperator.catch(() => undefined);
      await waitForBlockedQueryMatching(
        observer,
        "Second pre-identity operator did not select the event fallback.",
        /from "events".*for update/is,
      );

      firstRequestBlocker.release();
      await withDeadline(firstOperator, "First fallback operator did not finish.");
      await withDeadline(sessionInsert, "Session identity INSERT did not finish before the queued fallback.");

      const staleFallbackPid = await waitForDirectWaiter(
        observer,
        secondRequestBlocker.pid,
        "Pre-identity operator did not retain the fallback after identity creation.",
        /from "song_requests".*for update/is,
      );
      sessionMutexOperator = applyReject(legacyRequests[2].id);
      void sessionMutexOperator.catch(() => undefined);
      await waitForDirectWaiter(
        observer,
        staleFallbackPid,
        "Post-identity operator did not wait at the event SHARE guard.",
        /from "events".*for share/is,
      );

      secondRequestBlocker.release();
      const [staleFallbackResult, sessionMutexResult] = await withDeadline(
        Promise.all([staleFallbackOperator, sessionMutexOperator]),
        "Fallback and session-mutex operators did not finish after release.",
      );
      assert.equal(staleFallbackResult.request.status, "rejected");
      assert.equal(sessionMutexResult.request.status, "rejected");
    } finally {
      firstRequestBlocker.release();
      secondRequestBlocker.release();
      await Promise.allSettled([
        ...(firstOperator ? [firstOperator] : []),
        ...(staleFallbackOperator ? [staleFallbackOperator] : []),
        ...(sessionMutexOperator ? [sessionMutexOperator] : []),
        ...(sessionInsert ? [sessionInsert] : []),
      ]);
      await firstRequestBlocker.close();
      await secondRequestBlocker.close();
    }

    const [finalState] = await observer<{ sessions: number; rejected: number; audits: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM public.event_sessions WHERE event_id = ${legacyEvent.id}) AS sessions,
        count(*) FILTER (WHERE status = 'rejected')::integer AS rejected,
        (SELECT count(*)::integer FROM public.operator_audit_log WHERE event_id = ${legacyEvent.id}) AS audits
      FROM public.song_requests
      WHERE event_id = ${legacyEvent.id}
    `;
    assert.deepEqual(finalState, { sessions: 1, rejected: 3, audits: 3 });
  } finally {
    if (applicationDatabase) {
      await applicationDatabase.$client.end({ timeout: 5 });
      delete (globalThis as typeof globalThis & { pozaNutaDatabase?: unknown }).pozaNutaDatabase;
    }
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await identityWriter.end({ timeout: 5 });
    await observer.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
}, 180_000);

type LockTarget = "events" | "event_sessions" | "song_requests";
type TrackAttempt = <T>(attempt: Promise<T>) => Promise<T>;

async function holdRowLock(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  target: LockTarget,
  rowId: number,
  strength: "update" | "no key update" = "update",
) {
  const blocker = createPostgresTestClient(harness, "postgres", 1);
  const locked = deferred<number>();
  const release = deferred<void>();
  const heldLock = blocker.begin(async (transaction) => {
    const [backend] = await transaction<{ pid: number }[]>`
      SELECT pg_backend_pid()::integer AS pid
    `;
    if (target === "events") {
      await transaction`SELECT id FROM public.events WHERE id = ${rowId} FOR UPDATE`;
    } else if (target === "event_sessions") {
      if (strength === "no key update") {
        await transaction`SELECT id FROM public.event_sessions WHERE id = ${rowId} FOR NO KEY UPDATE`;
      } else {
        await transaction`SELECT id FROM public.event_sessions WHERE id = ${rowId} FOR UPDATE`;
      }
    } else {
      await transaction`SELECT id FROM public.song_requests WHERE id = ${rowId} FOR UPDATE`;
    }
    locked.resolve(backend.pid);
    await release.promise;
  });
  void heldLock.catch(() => undefined);

  try {
    const pid = await withDeadline(locked.promise, `${target} fixture lock was not acquired.`);
    return {
      pid,
      release: () => release.resolve(),
      close: async () => {
        release.resolve();
        await Promise.allSettled([heldLock]);
        await blocker.end({ timeout: 5 });
      },
    };
  } catch (error) {
    release.resolve();
    await Promise.allSettled([heldLock]);
    await blocker.end({ timeout: 5 });
    throw error;
  }
}

async function withHeldRowLock(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  target: LockTarget,
  rowId: number,
  action: (blockerPid: number, release: () => void, track: TrackAttempt) => Promise<void>,
  strength: "update" | "no key update" = "update",
) {
  const blocker = createPostgresTestClient(harness, "postgres", 1);
  const locked = deferred<number>();
  const release = deferred<void>();
  const attempts: Array<Promise<unknown>> = [];
  const track: TrackAttempt = (attempt) => {
    void attempt.catch(() => undefined);
    attempts.push(attempt);
    return attempt;
  };
  const heldLock = blocker.begin(async (transaction) => {
    const [backend] = await transaction<{ pid: number }[]>`SELECT pg_backend_pid()::integer AS pid`;
    if (target === "events") {
      await transaction`SELECT id FROM public.events WHERE id = ${rowId} FOR UPDATE`;
    } else if (target === "event_sessions") {
      if (strength === "no key update") {
        await transaction`SELECT id FROM public.event_sessions WHERE id = ${rowId} FOR NO KEY UPDATE`;
      } else {
        await transaction`SELECT id FROM public.event_sessions WHERE id = ${rowId} FOR UPDATE`;
      }
    } else {
      await transaction`SELECT id FROM public.song_requests WHERE id = ${rowId} FOR UPDATE`;
    }
    locked.resolve(backend.pid);
    await release.promise;
  });
  void heldLock.catch(() => undefined);

  try {
    const blockerPid = await withDeadline(locked.promise, `${target} fixture lock was not acquired.`);
    await action(blockerPid, () => release.resolve(), track);
  } finally {
    release.resolve();
    await Promise.allSettled(attempts);
    try {
      await heldLock;
    } finally {
      await blocker.end({ timeout: 5 });
    }
  }
}

async function waitForDirectWaiter(
  sql: postgres.Sql,
  blockerPid: number,
  message: string,
  queryPattern?: RegExp,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiters = await sql<{ pid: number; wait_event_type: string; query: string }[]>`
      SELECT pid, wait_event_type, query FROM pg_stat_activity
      WHERE datname = current_database()
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
        AND wait_event_type = 'Lock'
    `;
    const waiter = waiters.find(({ query }) => !queryPattern || queryPattern.test(query));
    if (waiter) return waiter.pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function waitForBlockedQueryMatching(
  sql: postgres.Sql,
  message: string,
  queryPattern: RegExp,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiters = await sql<{ pid: number; query: string }[]>`
      SELECT pid, query FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(pid)) > 0
    `;
    const waiter = waiters.find(({ query }) => queryPattern.test(query));
    if (waiter) return waiter.pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

function latestStartRequestId(entries: Array<Record<string, unknown>>, operation: string) {
  const entry = entries.slice().reverse().find((current) =>
    current.operation === operation && current.phase === "for_update_select_start",
  );
  assert.ok(entry && typeof entry.request_id === "string", `${operation} start telemetry is missing.`);
  return entry.request_id;
}

function latestOperationRequestId(entries: Array<Record<string, unknown>>, operation: string, phase: string) {
  const entry = entries.slice().reverse().find((current) =>
    current.operation === operation && current.phase === phase,
  );
  assert.ok(entry && typeof entry.request_id === "string", `${operation} ${phase} telemetry is missing.`);
  return entry.request_id;
}

function acquiredSelectMs(entries: Array<Record<string, unknown>>, requestId: string, operation: string) {
  const entry = entries.find((current) =>
    current.request_id === requestId && current.operation === operation && current.phase === "lock_acquired",
  );
  assert.ok(entry && typeof entry.for_update_select_ms === "number", `${operation} acquisition telemetry is missing.`);
  return entry.for_update_select_ms;
}

async function seedFixture(sql: postgres.Sql) {
  const authUserId = randomUUID();
  const organizationId = "contentiontestws0000";
  await sql`INSERT INTO auth.users (id) VALUES (${authUserId})`;
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Contention fixture', 'contention-fixture', ${organizationId})
    RETURNING id::integer
  `;
  const [operator] = await sql<{ id: number }[]>`
    INSERT INTO public.operator_users (name, display_name, profile_completed_at, auth_user_id, password_hash)
    VALUES ('contention_fixture_operator', 'Fixture Operator', now(), ${authUserId}, 'test-only')
    RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.workspace_members (workspace_id, operator_user_id, role)
    VALUES (${workspace.id}, ${operator.id}, 'owner')
  `;
  const [song] = await sql<{ id: number }[]>`
    INSERT INTO public.songs (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text)
    VALUES ('ising', 'contention-fixture', 'Fixture Song', 'Fixture Artist', 'fixture song', 'fixture artist', 'fixture song fixture artist')
    RETURNING id::integer
  `;
  const events: Array<{ id: number; publicId: string; sessionId: number; publicToken: string; requestIds: number[] }> = [];
  for (const index of [1, 2]) {
    const [event] = await sql<{ id: number; public_id: string }[]>`
      INSERT INTO public.events (workspace_id, name, starts_at, ends_at, auto_close_at, status, is_active_public_event, song_requests_enabled, public_queue_enabled)
      VALUES (${workspace.id}, ${`Fixture event ${index}`}, now() - interval '1 hour', now() + interval '2 hours', now() + interval '2 hours', 'active', false, true, true)
      RETURNING id::integer, public_id::text
    `;
    const publicToken = randomBytes(16).toString("base64url");
    const [session] = await sql<{ id: number }[]>`
      INSERT INTO public.event_sessions (event_id, public_token)
      VALUES (${event.id}, ${publicToken}) RETURNING id::integer
    `;
    const requests = await sql<{ id: number }[]>`
      INSERT INTO public.song_requests (event_id, song_id, singer_name, display_name, status, position, requested_by)
      VALUES (${event.id}, ${song.id}, 'Fixture', 'Fixture', 'pending', 0, 'public')
      ${index === 1 ? sql`, (${event.id}, ${song.id}, 'Fixture 2', 'Fixture 2', 'pending', 0, 'public')` : sql``}
      RETURNING id::integer
    `;
    events.push({ id: event.id, publicId: event.public_id, sessionId: session.id, publicToken, requestIds: requests.map(({ id }) => id) });
  }
  return {
    authUserId,
    organizationId,
    workspaceId: workspace.id,
    songId: song.id,
    firstEvent: events[0],
    secondEvent: events[1],
  };
}

async function waitForBlockedQuery(
  sql: postgres.Sql,
  blockerPid: number,
  expected: number,
  queryPattern?: RegExp,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiters = await sql<{ query: string; blockers: number[] }[]>`
      SELECT query, pg_blocking_pids(pid)::integer[] AS blockers
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(pid)) > 0
    `;
    const matchingWaiters = waiters.filter(({ query }) => !queryPattern || queryPattern.test(query));
    const directWaiters = matchingWaiters.filter(({ blockers }) => blockers.includes(blockerPid));
    if (matchingWaiters.length >= expected && directWaiters.length >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Expected application row-lock wait was not observed.");
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function withDeadline<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 5_000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
