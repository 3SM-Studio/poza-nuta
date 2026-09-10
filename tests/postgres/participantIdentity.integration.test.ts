import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { test, vi } from "vitest";

import {
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;

for (const image of images) {
  test(`${image}: participant identity, membership and request ownership`, async () => {
    const harness = await startPostgresTestHarness("pozanuta-participant", image);
    const sql = createPostgresTestClient(harness, "postgres", 8);

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 24);
      const [queueTrigger] = await sql<{ enabled: string }[]>`
        SELECT tgenabled AS enabled
        FROM pg_trigger
        WHERE tgname = 'song_requests_broadcast_queue_changed_trigger'
      `;
      assert.equal(queueTrigger?.enabled, "O");
      const fixture = await seedFixture(sql);

      await withApplicationDatabase(harness, async () => {
        const service = await import("../../src/server/session-api/service.ts");
        const operatorQueue = await import(
          "../../src/server/operator-api/event-queue.ts"
        );

        await assertLegacyRequestMutationGone(sql, fixture);

        assert.equal(
          await service.getPublicSessionParticipant(fixture.tokenA, null),
          null,
        );
        assert.equal(
          await service.getPublicSessionParticipant(fixture.tokenA, "malformed"),
          null,
        );

        const joinedA = await service.joinPublicSession(fixture.tokenA, null, {
          displayName: "Michał Żółć",
          normalizedDisplayName: "michał żółć",
        });
        assert.deepEqual(joinedA.participant, { displayName: "Michał Żółć" });
        assert.deepEqual(
          await service.getPublicSessionParticipant(
            fixture.tokenA,
            joinedA.credential,
          ),
          { displayName: "Michał Żółć" },
        );

        const [storedIdentity] = await sql<{
          participant_id: number;
          token_hash: string;
          display_name: string;
        }[]>`
          SELECT ep.participant_id::integer, pc.token_hash, ep.display_name
          FROM public.event_participants ep
          JOIN public.participant_credentials pc
            ON pc.participant_id = ep.participant_id
          WHERE ep.event_session_id = ${fixture.sessionA}
        `;
        assert.ok(storedIdentity);
        assert.equal(storedIdentity.display_name, "Michał Żółć");
        assert.match(storedIdentity.token_hash, /^[a-f0-9]{64}$/);
        assert.equal(
          storedIdentity.token_hash,
          createHash("sha256").update(joinedA.credential).digest("hex"),
          "Database must contain only the credential hash.",
        );

        await assert.rejects(
          service.joinPublicSession(fixture.tokenA, null, {
            displayName: "MICHAŁ ŻÓŁĆ",
            normalizedDisplayName: "michał żółć",
          }),
          hasPublicError(409, "SESSION_NICKNAME_TAKEN"),
        );

        const race = await Promise.allSettled([
          service.joinPublicSession(fixture.tokenA, null, {
            displayName: "Wyścig",
            normalizedDisplayName: "wyścig",
          }),
          service.joinPublicSession(fixture.tokenA, null, {
            displayName: "WYŚCIG",
            normalizedDisplayName: "wyścig",
          }),
        ]);
        assert.equal(race.filter(({ status }) => status === "fulfilled").length, 1);
        assert.equal(race.filter(({ status }) => status === "rejected").length, 1);

        assert.equal(
          await service.getPublicSessionParticipant(
            fixture.tokenB,
            joinedA.credential,
          ),
          null,
        );
        await assert.rejects(
          service.createPublicSessionRequest(
            fixture.tokenB,
            joinedA.credential,
            { songId: fixture.songId },
          ),
          hasPublicError(403, "SESSION_PARTICIPANT_REQUIRED"),
        );

        const joinedB = await service.joinPublicSession(
          fixture.tokenB,
          joinedA.credential,
          {
            displayName: "Michał Żółć",
            normalizedDisplayName: "michał żółć",
          },
        );
        assert.ok(
          joinedB.credential === joinedA.credential,
          "A recognized browser must keep the same credential.",
        );

        await service.createPublicSessionRequest(
          fixture.tokenA,
          joinedA.credential,
          { songId: fixture.songId },
        );
        const [ownedRequest] = await sql<{
          public_id: string;
          event_participant_id: number | null;
          display_name: string;
          singer_name: string;
          participant_id: number;
        }[]>`
          SELECT
            sr.public_id,
            sr.event_participant_id::integer,
            sr.display_name,
            sr.singer_name,
            ep.participant_id::integer
          FROM public.song_requests sr
          JOIN public.event_participants ep ON ep.id = sr.event_participant_id
          WHERE sr.event_id = ${fixture.eventA} AND sr.requested_by = 'public'
          ORDER BY sr.id DESC LIMIT 1
        `;
        assert.ok(ownedRequest.event_participant_id);
        assert.equal(ownedRequest.display_name, "Michał Żółć");
        assert.equal(ownedRequest.singer_name, "Michał Żółć");
        assert.equal(ownedRequest.participant_id, storedIdentity.participant_id);

        const otherA = await service.joinPublicSession(fixture.tokenA, null, {
          displayName: "Other Singer",
          normalizedDisplayName: "other singer",
        });
        const renameRace = await Promise.allSettled([
          service.renamePublicSessionParticipant(
            fixture.tokenA,
            joinedA.credential,
            { displayName: "Shared Name", normalizedDisplayName: "shared name" },
          ),
          service.renamePublicSessionParticipant(
            fixture.tokenA,
            otherA.credential,
            { displayName: "SHARED NAME", normalizedDisplayName: "shared name" },
          ),
        ]);
        assert.equal(renameRace.filter(({ status }) => status === "fulfilled").length, 1);
        const renameLoser = renameRace.find(({ status }) => status === "rejected");
        assert.ok(renameLoser?.status === "rejected");
        assert.equal(getPublicStatus(renameLoser.reason), 409);
        assert.equal(
          typeof renameLoser.reason === "object" && renameLoser.reason !== null &&
            "code" in renameLoser.reason
            ? renameLoser.reason.code
            : null,
          "SESSION_NICKNAME_TAKEN",
        );
        await service.joinPublicSession(fixture.tokenA, null, {
          displayName: "Collision Singer",
          normalizedDisplayName: "collision singer",
        });
        const foreignRequest = await service.createPublicSessionRequest(
          fixture.tokenA,
          otherA.credential,
          { songId: fixture.secondSongId },
        );
        const [credentialBeforeRead] = await sql<{ last_used_at: Date }[]>`
          SELECT last_used_at
          FROM public.participant_credentials
          WHERE token_hash = ${storedIdentity.token_hash}
        `;
        assert.deepEqual(
          (await service.getPublicParticipantRequests(
            fixture.tokenA,
            joinedA.credential,
          )).map(({ id }) => id),
          [ownedRequest.public_id],
        );
        const [credentialAfterRead] = await sql<{ last_used_at: Date }[]>`
          SELECT last_used_at
          FROM public.participant_credentials
          WHERE token_hash = ${storedIdentity.token_hash}
        `;
        assert.equal(
          credentialAfterRead.last_used_at.toISOString(),
          credentialBeforeRead.last_used_at.toISOString(),
        );
        assert.deepEqual(
          await service.getPublicParticipantRequests(
            fixture.tokenB,
            joinedA.credential,
          ),
          [],
        );
        await assert.rejects(
          service.cancelPublicParticipantRequest(
            fixture.tokenA,
            joinedA.credential,
            foreignRequest.id,
          ),
          hasPublicError(404, "SESSION_REQUEST_NOT_FOUND"),
        );

        const requestInB = await service.createPublicSessionRequest(
          fixture.tokenB,
          joinedB.credential,
          { songId: fixture.secondSongId },
        );
        await assert.rejects(
          service.cancelPublicParticipantRequest(
            fixture.tokenA,
            joinedA.credential,
            requestInB.id,
          ),
          hasPublicError(404, "SESSION_REQUEST_NOT_FOUND"),
        );

        await assert.rejects(
          service.renamePublicSessionParticipant(
            fixture.tokenA,
            joinedA.credential,
            {
              displayName: "COLLISION SINGER",
              normalizedDisplayName: "collision singer",
            },
          ),
          hasPublicError(409, "SESSION_NICKNAME_TAKEN"),
        );
        assert.deepEqual(
          await service.renamePublicSessionParticipant(
            fixture.tokenA,
            joinedA.credential,
            { displayName: "Nowy Michał", normalizedDisplayName: "nowy michał" },
          ),
          { displayName: "Nowy Michał" },
        );
        const [snapshotAfterRename] = await sql<{ display_name: string }[]>`
          SELECT display_name FROM public.song_requests
          WHERE public_id = ${ownedRequest.public_id}::uuid
        `;
        assert.equal(snapshotAfterRename.display_name, "Michał Żółć");

        const cancelled = await service.cancelPublicParticipantRequest(
          fixture.tokenA,
          joinedA.credential,
          ownedRequest.public_id,
        );
        assert.equal(cancelled.status, "skipped");
        await assert.rejects(
          service.cancelPublicParticipantRequest(
            fixture.tokenA,
            joinedA.credential,
            ownedRequest.public_id,
          ),
          hasPublicError(409, "SESSION_REQUEST_CANNOT_CANCEL"),
        );

        const raceRequest = await service.createPublicSessionRequest(
          fixture.tokenA,
          joinedA.credential,
          { songId: fixture.songId },
        );
        const [cancelledRequestRow] = await sql<{ id: number }[]>`
          SELECT id::integer
          FROM public.song_requests
          WHERE public_id = ${ownedRequest.public_id}::uuid
        `;
        assert.ok(cancelledRequestRow);
        await assert.rejects(
          operatorQueue.applyDashboardOrganizationEventQueueActionForAuthUser({
            authUserId: fixture.authUserId,
            organizationId: fixture.organizationId,
            eventId: fixture.eventPublicIdA,
            requestId: cancelledRequestRow.id,
            action: "restore",
          }),
          hasPublicError(409, "QUEUE_ACTIVE_DUPLICATE"),
        );
        const duplicateRestoreState = await sql<{
          public_id: string;
          status: string;
        }[]>`
          SELECT public_id::text, status::text
          FROM public.song_requests
          WHERE event_id = ${fixture.eventA}
            AND event_participant_id = ${ownedRequest.event_participant_id}
            AND song_id = ${fixture.songId}
          ORDER BY id
        `;
        assert.deepEqual(Array.from(duplicateRestoreState), [
          { public_id: ownedRequest.public_id, status: "skipped" },
          { public_id: raceRequest.id, status: "pending" },
        ]);
        assert.equal(
          duplicateRestoreState.filter(({ status }) =>
            ["pending", "approved", "now"].includes(status),
          ).length,
          1,
        );

        const cancelRace = await Promise.allSettled([
          service.cancelPublicParticipantRequest(
            fixture.tokenA,
            joinedA.credential,
            raceRequest.id,
          ),
          service.cancelPublicParticipantRequest(
            fixture.tokenA,
            joinedA.credential,
            raceRequest.id,
          ),
        ]);
        assert.equal(cancelRace.filter(({ status }) => status === "fulfilled").length, 1);
        assert.equal(cancelRace.filter(({ status }) => status === "rejected").length, 1);
        const cancelLoser = cancelRace.find(({ status }) => status === "rejected");
        assert.ok(cancelLoser?.status === "rejected");
        assert.equal(getPublicStatus(cancelLoser.reason), 409);
        assert.equal(
          typeof cancelLoser.reason === "object" && cancelLoser.reason !== null &&
            "code" in cancelLoser.reason
            ? cancelLoser.reason.code
            : null,
          "SESSION_REQUEST_CANNOT_CANCEL",
        );
        const restoredWithoutDuplicate =
          await operatorQueue.applyDashboardOrganizationEventQueueActionForAuthUser({
            authUserId: fixture.authUserId,
            organizationId: fixture.organizationId,
            eventId: fixture.eventPublicIdA,
            requestId: cancelledRequestRow.id,
            action: "restore",
          });
        assert.equal(restoredWithoutDuplicate.request.status, "pending");
        assert.equal(
          (
            await service.cancelPublicParticipantRequest(
              fixture.tokenA,
              joinedA.credential,
              ownedRequest.public_id,
            )
          ).status,
          "skipped",
        );

        const approvedRequest = await service.createPublicSessionRequest(
          fixture.tokenA,
          joinedA.credential,
          { songId: fixture.songId },
        );
        await sql`
          UPDATE public.song_requests SET status = 'approved', position = 1
          WHERE public_id = ${approvedRequest.id}::uuid
        `;
        await sql`
          INSERT INTO public.song_requests (
            event_id, song_id, singer_name, display_name, status, position,
            requested_by, event_participant_id
          ) VALUES
            (${fixture.eventA}, ${fixture.secondSongId}, 'Snapshot', 'Snapshot', 'pending', 2, 'public', ${ownedRequest.event_participant_id}),
            (${fixture.eventA}, ${fixture.secondSongId}, 'Snapshot', 'Snapshot', 'now', 0, 'public', ${ownedRequest.event_participant_id}),
            (${fixture.eventA}, ${fixture.secondSongId}, 'Snapshot', 'Snapshot', 'done', 0, 'public', ${ownedRequest.event_participant_id}),
            (${fixture.eventA}, ${fixture.secondSongId}, 'Snapshot', 'Snapshot', 'rejected', 0, 'public', ${ownedRequest.event_participant_id})
        `;
        const ownItems = await service.getPublicParticipantRequests(
          fixture.tokenA,
          joinedA.credential,
        );
        const approvedItem = ownItems.find(({ id }) => id === approvedRequest.id);
        assert.equal(approvedItem?.queuePosition, 1);
        assert.equal(approvedItem?.isNext, true);
        assert.deepEqual(
          new Set(ownItems.map(({ status }) => status)),
          new Set(["pending", "approved", "now", "done", "skipped", "rejected"]),
        );
        await assert.rejects(
          service.cancelPublicParticipantRequest(
            fixture.tokenA,
            joinedA.credential,
            approvedRequest.id,
          ),
          hasPublicError(409, "SESSION_REQUEST_CANNOT_CANCEL"),
        );
        await assert.rejects(
          service.cancelPublicParticipantRequest(
            fixture.closedToken,
            joinedA.credential,
            approvedRequest.id,
          ),
          hasPublicError(403, "SESSION_EVENT_CLOSED"),
        );

        for (const lifecycleToken of [
          fixture.scheduledToken,
          fixture.cancelledToken,
        ]) {
          await assert.rejects(
            service.getPublicParticipantRequests(
              lifecycleToken,
              joinedA.credential,
            ),
            (error: unknown) => getPublicStatus(error) === 403,
          );
          await assert.rejects(
            service.renamePublicSessionParticipant(
              lifecycleToken,
              joinedA.credential,
              { displayName: "Lifecycle", normalizedDisplayName: "lifecycle" },
            ),
            (error: unknown) => getPublicStatus(error) === 403,
          );
          await assert.rejects(
            service.cancelPublicParticipantRequest(
              lifecycleToken,
              joinedA.credential,
              approvedRequest.id,
            ),
            (error: unknown) => getPublicStatus(error) === 403,
          );
        }

        await sql`
          UPDATE public.events e
          SET status = 'active', starts_at = now() - interval '1 hour',
              ends_at = now() + interval '1 hour', auto_close_at = now() + interval '1 hour',
              closed_at = NULL, close_reason = NULL
          FROM public.event_sessions s
          WHERE s.event_id = e.id AND s.public_token = ${fixture.closedToken}
        `;
        const reopened = await service.joinPublicSession(
          fixture.closedToken,
          joinedA.credential,
          { displayName: "Reopened", normalizedDisplayName: "reopened" },
        );
        const reopenedRequest = await service.createPublicSessionRequest(
          fixture.closedToken,
          reopened.credential,
          { songId: fixture.songId },
        );
        assert.equal(
          (await service.getPublicParticipantRequests(
            fixture.closedToken,
            reopened.credential,
          ))[0]?.id,
          reopenedRequest.id,
        );
        assert.equal(
          (await service.cancelPublicParticipantRequest(
            fixture.closedToken,
            reopened.credential,
            reopenedRequest.id,
          )).status,
          "skipped",
        );

        await assert.rejects(
          service.createPublicSessionRequest(
            fixture.tokenA,
            joinedA.credential,
            { songId: fixture.songId },
          ),
          hasPublicError(409, "SESSION_REQUEST_DUPLICATE"),
        );

        const restoreRaceParticipant = await service.joinPublicSession(
          fixture.tokenA,
          null,
          {
            displayName: "Restore Race",
            normalizedDisplayName: "restore race",
          },
        );
        const restoreRaceOriginal = await service.createPublicSessionRequest(
          fixture.tokenA,
          restoreRaceParticipant.credential,
          { songId: fixture.secondSongId },
        );
        await service.cancelPublicParticipantRequest(
          fixture.tokenA,
          restoreRaceParticipant.credential,
          restoreRaceOriginal.id,
        );
        const [restoreRaceRow] = await sql<{
          id: number;
          event_participant_id: number;
        }[]>`
          SELECT id::integer, event_participant_id::integer
          FROM public.song_requests
          WHERE public_id = ${restoreRaceOriginal.id}::uuid
        `;
        assert.ok(restoreRaceRow);

        const restoreVsResubmit = await Promise.allSettled([
          service.createPublicSessionRequest(
            fixture.tokenA,
            restoreRaceParticipant.credential,
            { songId: fixture.secondSongId },
          ),
          operatorQueue.applyDashboardOrganizationEventQueueActionForAuthUser({
            authUserId: fixture.authUserId,
            organizationId: fixture.organizationId,
            eventId: fixture.eventPublicIdA,
            requestId: restoreRaceRow.id,
            action: "restore",
          }),
        ]);
        assert.equal(
          restoreVsResubmit.filter(({ status }) => status === "fulfilled").length,
          1,
        );
        assert.equal(
          restoreVsResubmit.filter(({ status }) => status === "rejected").length,
          1,
        );
        const restoreVsResubmitLoser = restoreVsResubmit.find(
          ({ status }) => status === "rejected",
        );
        assert.ok(restoreVsResubmitLoser?.status === "rejected");
        assert.equal(getPublicStatus(restoreVsResubmitLoser.reason), 409);
        assert.ok(
          typeof restoreVsResubmitLoser.reason === "object" &&
            restoreVsResubmitLoser.reason !== null &&
            "code" in restoreVsResubmitLoser.reason &&
            ["SESSION_REQUEST_DUPLICATE", "QUEUE_ACTIVE_DUPLICATE"].includes(
              String(restoreVsResubmitLoser.reason.code),
            ),
        );
        const [activeRestoreRaceCount] = await sql<{ count: number }[]>`
          SELECT count(*)::integer AS count
          FROM public.song_requests
          WHERE event_id = ${fixture.eventA}
            AND event_participant_id = ${restoreRaceRow.event_participant_id}
            AND song_id = ${fixture.secondSongId}
            AND status IN ('pending', 'approved', 'now')
        `;
        assert.equal(activeRestoreRaceCount.count, 1);

        await sql`
          INSERT INTO public.song_requests (
            event_id, song_id, singer_name, display_name, position, requested_by
          ) VALUES (
            ${fixture.eventA}, ${fixture.secondSongId}, 'Operator Guest',
            'Operator Guest', 99, 'operator'
          )
        `;
        const [operatorRequest] = await sql<{
          public_id: string;
          event_participant_id: number | null;
        }[]>`
          SELECT public_id, event_participant_id::integer
          FROM public.song_requests
          WHERE event_id = ${fixture.eventA} AND requested_by = 'operator'
          ORDER BY id DESC LIMIT 1
        `;
        assert.equal(operatorRequest.event_participant_id, null);
        await assert.rejects(
          service.cancelPublicParticipantRequest(
            fixture.tokenA,
            joinedA.credential,
            operatorRequest.public_id,
          ),
          hasPublicError(404, "SESSION_REQUEST_NOT_FOUND"),
        );

        const recovered = await service.joinPublicSession(
          fixture.tokenA,
          "malformed",
          {
            displayName: "Recovered Person",
            normalizedDisplayName: "recovered person",
          },
        );
        assert.ok(
          recovered.credential !== "malformed",
          "Malformed credentials must be replaced safely.",
        );
        assert.deepEqual(
          await service.getPublicSessionParticipant(
            fixture.tokenA,
            recovered.credential,
          ),
          { displayName: "Recovered Person" },
        );

        for (const token of [
          fixture.scheduledToken,
          fixture.cancelledToken,
        ]) {
          await assert.rejects(
            service.joinPublicSession(token, null, {
              displayName: "Lifecycle",
              normalizedDisplayName: "lifecycle",
            }),
            (error: unknown) => getPublicStatus(error) === 403,
          );
        }

        await sql`
          UPDATE public.participant_credentials
          SET revoked_at = now()
          WHERE token_hash = ${storedIdentity.token_hash}
        `;
        assert.equal(
          await service.getPublicSessionParticipant(
            fixture.tokenA,
            joinedA.credential,
          ),
          null,
        );
        await assert.rejects(
          service.createPublicSessionRequest(
            fixture.tokenA,
            joinedA.credential,
            { songId: fixture.secondSongId },
          ),
          hasPublicError(403, "SESSION_PARTICIPANT_REQUIRED"),
        );

        const expiring = await service.joinPublicSession(
          fixture.tokenA,
          null,
          {
            displayName: "Expired Person",
            normalizedDisplayName: "expired person",
          },
        );
        await sql`
          UPDATE public.participant_credentials pc
          SET
            created_at = now() - interval '2 days',
            last_used_at = now() - interval '2 days',
            expires_at = now() - interval '1 day'
          FROM public.event_participants ep
          WHERE ep.participant_id = pc.participant_id
            AND ep.display_name = 'Expired Person'
        `;
        assert.equal(
          await service.getPublicSessionParticipant(
            fixture.tokenA,
            expiring.credential,
          ),
          null,
        );

        await assertRouteSecurityAndCookie(fixture.tokenA);
      });

      const [tableState] = await sql<{
        relrowsecurity: boolean;
        anonPrivileges: number;
      }[]>`
        SELECT
          bool_and(c.relrowsecurity) AS relrowsecurity,
          count(*) FILTER (
            WHERE has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
          )::integer AS "anonPrivileges"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
            'participant_identities', 'participant_credentials', 'event_participants'
          )
      `;
      assert.deepEqual(tableState, { relrowsecurity: true, anonPrivileges: 0 });
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });
}

async function assertRouteSecurityAndCookie(token: string) {
  const [
    { POST },
    { GET, PATCH },
    { GET: GET_MINE },
    { DELETE },
    { resetSessionRateLimitForTests },
  ] = await Promise.all([
    import("../../src/app/api/s/[token]/join/route.ts"),
    import("../../src/app/api/s/[token]/participant/route.ts"),
    import("../../src/app/api/s/[token]/requests/mine/route.ts"),
    import("../../src/app/api/s/[token]/requests/[requestId]/route.ts"),
    import("../../src/server/session-api/rate-limit-core.ts"),
  ]);
  resetSessionRateLimitForTests();
  const previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = "http://localhost";

  try {
    const foreign = await POST(
      new NextRequest(`http://localhost/api/s/${token}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "localhost",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ displayName: "Foreign Origin" }),
      }),
      { params: Promise.resolve({ token }) },
    );
    assert.equal(foreign.status, 403);

    const response = await POST(
      new NextRequest(`http://localhost/api/s/${token}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          host: "localhost",
          origin: "http://localhost",
        },
        body: JSON.stringify({ displayName: "Route Person" }),
      }),
      { params: Promise.resolve({ token }) },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      participant: { displayName: "Route Person" },
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookieAttributes = setCookie
      .split(";")
      .slice(1)
      .map((attribute) => attribute.trim().toLowerCase());
    assert.ok(
      setCookie.startsWith("poza_nuta_participant="),
      "Participant cookie name is missing.",
    );
    assert.ok(cookieAttributes.includes("httponly"), "HttpOnly is missing.");
    assert.ok(cookieAttributes.includes("samesite=lax"), "SameSite is missing.");
    assert.ok(cookieAttributes.includes("path=/"), "Cookie path is missing.");
    assert.ok(!cookieAttributes.includes("secure"), "Local cookie must not be Secure.");

    const cookie = setCookie.split(";", 1)[0]!;
    const participantResponse = await GET(
      new NextRequest(`http://localhost/api/s/${token}/participant`, {
        headers: { cookie, "x-forwarded-for": "192.0.2.99" },
      }),
      { params: Promise.resolve({ token }) },
    );
    assert.equal(participantResponse.status, 200);
    assert.deepEqual(await participantResponse.json(), {
      participant: { displayName: "Route Person" },
    });

    const mineResponse = await GET_MINE(
      new NextRequest(`http://localhost/api/s/${token}/requests/mine`, {
        headers: { cookie, "x-forwarded-for": "192.0.2.100" },
      }),
      { params: Promise.resolve({ token }) },
    );
    assert.equal(mineResponse.status, 200);
    assert.deepEqual(await mineResponse.json(), { items: [] });

    const foreignRename = await PATCH(
      new NextRequest(`http://localhost/api/s/${token}/participant`, {
        method: "PATCH",
        headers: {
          cookie,
          "content-type": "application/json",
          host: "localhost",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ displayName: "Stolen" }),
      }),
      { params: Promise.resolve({ token }) },
    );
    assert.equal(foreignRename.status, 403);

    const foreignCancel = await DELETE(
      new NextRequest(
        `http://localhost/api/s/${token}/requests/c09f9509-0677-45cc-98b2-b6f3892035de`,
        {
          method: "DELETE",
          headers: {
            cookie,
            "content-type": "application/json",
            host: "localhost",
            origin: "https://attacker.example",
          },
          body: "{}",
        },
      ),
      {
        params: Promise.resolve({
          token,
          requestId: "c09f9509-0677-45cc-98b2-b6f3892035de",
        }),
      },
    );
    assert.equal(foreignCancel.status, 403);
  } finally {
    if (previousSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousSiteUrl;
  }
}

async function assertLegacyRequestMutationGone(
  sql: ReturnType<typeof createPostgresTestClient>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
) {
  const { POST } = await import(
    "../../src/app/api/session/[code]/requests/route.ts"
  );
  const [before] = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM public.song_requests
    WHERE event_id = ${fixture.eventA}
  `;
  assert.ok(before);

  for (const body of [
    { songId: fixture.songId },
    { songId: fixture.songId, requesterName: "Admin" },
  ]) {
    const response = await Reflect.apply(POST, undefined, [
      new NextRequest("http://localhost/api/session/00000001/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ code: "00000001" }) },
    ]);
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), {
      error: {
        code: "SESSION_REQUEST_ENDPOINT_GONE",
        message:
          "Song requests require a joined participant session. Use /api/s/[token]/requests.",
      },
    });
  }

  const [after] = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM public.song_requests
    WHERE event_id = ${fixture.eventA}
  `;
  assert.deepEqual(after, before);
}

async function seedFixture(sql: ReturnType<typeof createPostgresTestClient>) {
  const authUserId = randomUUID();
  const organizationId = "participanttest00001";
  await sql`INSERT INTO auth.users (id) VALUES (${authUserId})`;
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Participant test', 'participant-test', ${organizationId})
    RETURNING id::integer
  `;
  assert.ok(workspace);
  const [operator] = await sql<{ id: number }[]>`
    INSERT INTO public.operator_users (
      name, display_name, profile_completed_at, auth_user_id, password_hash
    ) VALUES (
      'participant_test_operator', 'Participant Test Operator', now(),
      ${authUserId}, 'test-only'
    )
    RETURNING id::integer
  `;
  assert.ok(operator);
  await sql`
    INSERT INTO public.workspace_members (workspace_id, operator_user_id, role)
    VALUES (${workspace.id}, ${operator.id}, 'owner')
  `;

  const now = Date.now();
  const eventInputs = [
    { name: "A", status: "active", starts: now - 3_600_000, ends: now + 3_600_000 },
    { name: "B", status: "active", starts: now - 3_600_000, ends: now + 3_600_000 },
    { name: "Scheduled", status: "draft", starts: now + 3_600_000, ends: now + 7_200_000 },
    { name: "Closed", status: "closed", starts: now - 7_200_000, ends: now - 3_600_000 },
    { name: "Cancelled", status: "cancelled", starts: now - 3_600_000, ends: now + 3_600_000 },
  ] as const;
  const events: Array<{
    id: number;
    publicId: string;
    sessionId: number;
    token: string;
  }> = [];

  for (const [index, input] of eventInputs.entries()) {
    const [event] = await sql<{ id: number; public_id: string }[]>`
      INSERT INTO public.events (
        workspace_id, name, session_code, starts_at, ends_at, status,
        song_requests_enabled, public_queue_enabled, closed_at, close_reason
      ) VALUES (
        ${workspace.id}, ${input.name}, ${String(index + 1).padStart(8, "0")},
        ${new Date(input.starts)}, ${new Date(input.ends)}, ${input.status},
        true, true,
        ${input.status === "closed" ? new Date(input.ends) : null},
        ${input.status === "closed" ? "manual" : null}
      ) RETURNING id::integer, public_id
    `;
    assert.ok(event);
    const token = String.fromCharCode(65 + index).repeat(22);
    const [session] = await sql<{ id: number }[]>`
      INSERT INTO public.event_sessions (event_id, public_token)
      VALUES (${event.id}, ${token}) RETURNING id::integer
    `;
    assert.ok(session);
    events.push({
      id: event.id,
      publicId: event.public_id,
      sessionId: session.id,
      token,
    });
  }

  const songs = await sql<{ id: number }[]>`
    INSERT INTO public.songs (
      source, source_song_id, title, artist, normalized_title,
      normalized_artist, search_text
    ) VALUES
      ('manual', 'participant-1', 'First Song', 'Artist', 'first song', 'artist', 'first song artist'),
      ('manual', 'participant-2', 'Second Song', 'Artist', 'second song', 'artist', 'second song artist')
    RETURNING id::integer
  `;
  assert.equal(songs.length, 2);

  return {
    authUserId,
    organizationId,
    eventA: events[0]!.id,
    eventPublicIdA: events[0]!.publicId,
    sessionA: events[0]!.sessionId,
    tokenA: events[0]!.token,
    tokenB: events[1]!.token,
    scheduledToken: events[2]!.token,
    closedToken: events[3]!.token,
    cancelledToken: events[4]!.token,
    songId: songs[0]!.id,
    secondSongId: songs[1]!.id,
  };
}

function hasPublicError(status: number, code: string) {
  return (error: unknown) =>
    getPublicStatus(error) === status &&
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

function getPublicStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? error.status
    : undefined;
}

async function withApplicationDatabase(
  harness: PostgresTestHarness,
  action: () => Promise<void>,
) {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `postgresql://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
  clearApplicationDatabase();
  try {
    await action();
  } finally {
    const database = getApplicationDatabase();
    if (database) await database.$client.end({ timeout: 5 });
    clearApplicationDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

type ApplicationDatabase = {
  $client: { end(options: { timeout: number }): Promise<void> };
};

function getApplicationDatabase() {
  return (
    globalThis as typeof globalThis & { pozaNutaDatabase?: ApplicationDatabase }
  ).pozaNutaDatabase;
}

function clearApplicationDatabase() {
  delete (
    globalThis as typeof globalThis & { pozaNutaDatabase?: ApplicationDatabase }
  ).pozaNutaDatabase;
}
