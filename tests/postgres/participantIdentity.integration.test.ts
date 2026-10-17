import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import { test, vi } from "vitest";
import type postgres from "postgres";
import { runFaultProcess } from "./faultProcessHarness";
import { queuePlacementRevision } from "../../src/lib/queue-placement";

import {
  applyPostgresMigration,
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
  type PostgresTestHarness,
} from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

const images = ["postgres:17-alpine"] as const;

for (const image of images) {
  test(`${image}: participant identity, membership and request ownership`, async () => {
    const harness = await startPostgresTestHarness("pozanuta-participant", image);
    const sql = createPostgresTestClient(harness, "postgres", 8);

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 24);
      await applyPostgresMigration(sql, 30);
    await applyPostgresMigration(sql, 32);
    await applyPostgresMigration(sql, 33);
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

for (const image of images) {
  test(`${image}: participant 2/2 limit serializes create and reactivation`, async () => {
    const harness = await startPostgresTestHarness("pozanuta-request-limit", image);
    const sql = createPostgresTestClient(harness, "postgres", 8);
    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 24);
      await applyPostgresMigration(sql, 30);
    await applyPostgresMigration(sql, 32);
    await applyPostgresMigration(sql, 33);
      const fixture = await seedFixture(sql);
      const [thirdSong] = await sql<{ id: number }[]>`
        INSERT INTO public.songs (
          source, source_song_id, title, artist, normalized_title, normalized_artist, search_text
        ) VALUES ('manual', 'limit-3', 'Third Song', 'Artist', 'third song', 'artist', 'third song artist')
        RETURNING id::integer
      `;
      await withApplicationDatabase(harness, async () => {
        const service = await import("../../src/server/session-api/service.ts");
        const { applyDashboardOrganizationEventQueueActionForAuthUser: applyAction } =
          await import("../../src/server/operator-api/event-queue.ts");
        const songIds = [fixture.songId, fixture.secondSongId, thirdSong.id];
        const limitError = hasPublicError(409, "SESSION_REQUEST_LIMIT_REACHED");
        const join = (name: string) => service.joinPublicSession(fixture.tokenA, null, {
          displayName: name, normalizedDisplayName: name.toLowerCase(),
        });
        const participant = await join("Limit Singer");
        const create = (songId: number) => service.createPublicSessionRequest(
          fixture.tokenA, participant.credential, { songId },
        );
        const activeCount = async () => (await service.getPublicParticipantRequests(
          fixture.tokenA, participant.credential,
        )).filter(({ status }) => ["pending", "approved", "now"].includes(status)).length;
        const action = async (publicId: string, name: "approve" | "start" | "done" | "reject" | "restore") => {
          const [row] = await sql<{ id: number }[]>`
            SELECT id::integer FROM public.song_requests WHERE public_id = ${publicId}
          `;
          return applyAction({
            authUserId: fixture.authUserId, organizationId: fixture.organizationId,
            eventId: fixture.eventPublicIdA, requestId: row.id, action: name,
          });
        };
        const raceAtQueueMutex = async (operations: (() => Promise<unknown>)[]) => {
          let release = () => {};
          let acquired = () => {};
          const gate = new Promise<void>((resolve) => { release = resolve; });
          const ready = new Promise<void>((resolve) => { acquired = resolve; });
          const blocker = sql.begin(async (transaction) => {
            await transaction`SELECT id FROM public.event_sessions WHERE id = ${fixture.sessionA} FOR NO KEY UPDATE`;
            acquired();
            await gate;
          });
          await ready;
          const results = Promise.allSettled(operations.map((operation) => operation()));
          try {
            // The runtime pool has two connections. Force both to overlap at
            // the actual mutex rather than relying on incidental scheduling.
            const deadline = Date.now() + 1_500;
            let waiting = 0;
            while (Date.now() < deadline) {
              const [row] = await sql<{ waiting: number }[]>`
                SELECT count(*)::integer AS waiting FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'
                  AND query LIKE '%event_sessions%'
              `;
              waiting = row.waiting;
              if (waiting >= 2) break;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            assert.ok(waiting >= 2, "Both application transactions must wait for the session queue mutex");
          } finally {
            release();
            await blocker;
            await results;
          }
          return results;
        };

        assert.equal(await activeCount(), 0);
        const first = await create(songIds[0]);
        assert.equal(await activeCount(), 1);
        const second = await create(songIds[1]);
        assert.equal(await activeCount(), 2);
        await assert.rejects(create(songIds[2]), limitError);
        await assert.rejects(create(songIds[0]), hasPublicError(409, "SESSION_REQUEST_DUPLICATE"));
        await service.renamePublicSessionParticipant(fixture.tokenA, participant.credential, {
          displayName: "Renamed Singer", normalizedDisplayName: "renamed singer",
        });
        await assert.rejects(create(songIds[2]), limitError);
        // Reloading canonical API state and changing nick cannot reset capacity.
        assert.equal(await activeCount(), 2);

        await action(first.id, "approve");
        await action(first.id, "start");
        assert.equal(await activeCount(), 2, "now occupies a slot");
        await action(first.id, "done");
        assert.equal(await activeCount(), 1);
        const third = await create(songIds[2]);
        await assert.rejects(action(first.id, "restore"), limitError);
        await action(second.id, "reject");
        assert.equal(await activeCount(), 1);
        await action(first.id, "restore");
        await assert.rejects(action(second.id, "approve"), limitError);
        await service.cancelPublicParticipantRequest(fixture.tokenA, participant.credential, third.id);
        assert.equal(await activeCount(), 1);
        await action(second.id, "approve");
        assert.equal(await activeCount(), 2);
        await action(first.id, "reject");

        const raceAtOne = await raceAtQueueMutex([() => create(songIds[0]), () => create(songIds[2])]);
        assert.equal(raceAtOne.filter(({ status }) => status === "fulfilled").length, 1);
        for (const result of raceAtOne) {
          if (result.status === "rejected") assert.ok(limitError(result.reason));
        }
        assert.equal(await activeCount(), 2);

        const other = await join("Other Identity");
        const raceAtZero = await raceAtQueueMutex(songIds.map((songId) => () =>
          service.createPublicSessionRequest(fixture.tokenA, other.credential, { songId }),
        ));
        assert.equal(raceAtZero.filter(({ status }) => status === "fulfilled").length, 2);
        for (const result of raceAtZero) {
          if (result.status === "rejected") assert.ok(limitError(result.reason));
        }
        await service.joinPublicSession(fixture.tokenB, participant.credential, {
          displayName: "Other Event", normalizedDisplayName: "other event",
        });
        await service.createPublicSessionRequest(fixture.tokenB, participant.credential, { songId: songIds[0] });
        assert.equal(await activeCount(), 2, "another event has separate capacity");

        // Direct HTTP cannot bypass the server guard or select another identity.
        const { POST } = await import("../../src/app/api/s/[token]/requests/route.ts");
        const { PARTICIPANT_CREDENTIAL_COOKIE } = await import("../../src/server/session-api/participant-credential.ts");
        const { resetSessionRateLimitForTests } = await import("../../src/server/session-api/rate-limit-core.ts");
        resetSessionRateLimitForTests();
        const mine = await service.getPublicParticipantRequests(fixture.tokenA, other.credential);
        const requestedTitles = new Set(mine.map(({ title }) => title));
        const missingSongId = songIds.find((_id, index) =>
          !requestedTitles.has(["First Song", "Second Song", "Third Song"][index]),
        );
        assert.ok(missingSongId);
        const previousSiteUrl = process.env.SITE_URL;
        process.env.SITE_URL = "http://localhost";
        let response: Response;
        try {
          response = await POST(new NextRequest(`http://localhost/api/s/${fixture.tokenA}/requests`, {
          method: "POST",
          headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost", cookie: `${PARTICIPANT_CREDENTIAL_COOKIE}=${other.credential}` },
          body: JSON.stringify({ songId: missingSongId }),
          }), { params: Promise.resolve({ token: fixture.tokenA }) });
        } finally {
          if (previousSiteUrl === undefined) delete process.env.SITE_URL;
          else process.env.SITE_URL = previousSiteUrl;
        }
        assert.equal(response.status, 409);
        assert.equal((await response.json()).error.code, "SESSION_REQUEST_LIMIT_REACHED");

        // A restore racing a create shares exactly the same queue mutex.
        const racer = await join("Restore Race");
        const old = await service.createPublicSessionRequest(fixture.tokenA, racer.credential, { songId: songIds[0] });
        await action(old.id, "reject");
        await service.createPublicSessionRequest(fixture.tokenA, racer.credential, { songId: songIds[1] });
        const mixed = await raceAtQueueMutex([
          () => action(old.id, "restore"),
          () => service.createPublicSessionRequest(fixture.tokenA, racer.credential, { songId: songIds[2] }),
        ]);
        assert.equal(mixed.filter(({ status }) => status === "fulfilled").length, 1);
        for (const result of mixed) {
          if (result.status === "rejected") assert.ok(limitError(result.reason));
        }

        // requested_by=operator is no bypass when attached to an event participant.
        // The preceding race may have restored songIds[0]. Use a distinct song
        // here so this assertion always isolates capacity, rather than duplicate
        // validation (which correctly has precedence when both conflicts exist).
        const [manualSong] = await sql<{ id: number }[]>`insert into public.songs
          (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text)
          values ('manual', 'capacity-manual-restore', 'Manual Restore', 'Artist', 'manual restore', 'artist', 'manual restore artist') returning id::integer`;
        const [manual] = await sql<{ public_id: string }[]>`
          INSERT INTO public.song_requests (event_id, song_id, singer_name, display_name,
            status, position, requested_by, event_participant_id)
          SELECT ${fixture.eventA}, ${manualSong.id}, 'Manual', 'Manual', 'rejected', 0,
            'operator', event_participant_id FROM public.song_requests
          WHERE public_id = ${old.id} RETURNING public_id
        `;
        await assert.rejects(action(manual.public_id, "restore"), limitError);
      });
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });
}

for (const image of images) {
  test(`${image}: operator participant management, RBAC, shared capacity and private invalidation`, async () => {
    const harness = await startPostgresTestHarness("pozanuta-participant-management", image);
    const sql = createPostgresTestClient(harness, "postgres", 8);
    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 29);
      await applyPostgresMigration(sql, 30);
    await applyPostgresMigration(sql, 32);
    await applyPostgresMigration(sql, 33);
      const fixture = await seedFixture(sql, 6);
      await sql.unsafe(`CREATE TABLE public.test_participant_broadcasts (payload jsonb, event_name text, topic text, private boolean);
        CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event_name text, topic_name text, private_channel boolean)
        RETURNS void LANGUAGE plpgsql AS $$ BEGIN
          INSERT INTO public.test_participant_broadcasts VALUES (payload, event_name, topic_name, private_channel);
        END; $$;
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
      const viewerAuth = randomUUID();
      await sql`INSERT INTO auth.users (id) VALUES (${viewerAuth})`;
      const [viewer] = await sql<{ id: number }[]>`
        INSERT INTO public.operator_users (name, auth_user_id, password_hash)
        VALUES ('Viewer', ${viewerAuth}, 'test-only') RETURNING id::integer
      `;
      await sql`INSERT INTO public.workspace_members (workspace_id, operator_user_id, role)
        SELECT workspace_id, ${viewer.id}, 'viewer' FROM public.events WHERE id = ${fixture.eventA}`;
      const [foreignWorkspace] = await sql<{ id: number }[]>`INSERT INTO public.workspaces (public_id, name, handle)
        VALUES ('foreignworkspace0001', 'Foreign workspace', 'foreign-workspace') RETURNING id::integer`;
      const [foreignEvent] = await sql<{ id: number; public_id: string }[]>`INSERT INTO public.events
        (workspace_id, name, session_code, starts_at, ends_at, status)
        VALUES (${foreignWorkspace.id}, 'Foreign', '000099', now() - interval '1 hour', now() + interval '1 hour', 'active')
        RETURNING id::integer, public_id`;
      const [thirdSong] = await sql<{ id: number }[]>`
        INSERT INTO public.songs (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text)
        VALUES ('manual', 'management-third', 'Third Song', 'Artist', 'third song', 'artist', 'third song artist') RETURNING id::integer
      `;
      await withApplicationDatabase(harness, async () => {
        const service = await import("../../src/server/operator-api/event-participants.ts");
        const publicService = await import("../../src/server/session-api/service.ts");
        const { applyDashboardOrganizationEventQueueActionForAuthUser: action } = await import("../../src/server/operator-api/event-queue.ts");
        const scope = { authUserId: fixture.authUserId, organizationId: fixture.organizationId, eventId: fixture.eventPublicIdA };
        const viewerScope = { ...scope, authUserId: viewerAuth };
        const otherScope = { ...scope, eventId: fixture.eventPublicIdB };
        const missingScope = { ...scope, organizationId: "anotherworkspace0001" };
        const foreignScope = { ...scope, organizationId: "foreignworkspace0001", eventId: foreignEvent.public_id };
        const joined = await publicService.joinPublicSession(fixture.tokenA, null, { displayName: "Mobile Singer", normalizedDisplayName: "mobile singer" });
        const mobile = (await service.listEventParticipants(scope)).items.find(({ displayName }) => displayName === "Mobile Singer");
        assert.ok(mobile);
        assert.equal(mobile.activeCount, 0);
        assert.equal(mobile.hasPerformed, false);
        const before = await sql`SELECT count(*)::integer AS count FROM public.participant_credentials`;
        const manual = await service.createEventParticipant({ ...scope, displayName: "Manual Singer" });
        const after = await sql`SELECT count(*)::integer AS count FROM public.participant_credentials`;
        assert.equal(after[0].count, before[0].count);
        const [identity] = await sql<{ participant_id: number; credentials: number }[]>`
          SELECT ep.participant_id::integer, count(pc.id)::integer AS credentials
          FROM public.event_participants ep LEFT JOIN public.participant_credentials pc ON pc.participant_id = ep.participant_id
          WHERE ep.id = ${manual.participant.id} GROUP BY ep.id
        `;
        assert.equal(identity.credentials, 0);
        const [identityCount] = await sql`SELECT count(*)::integer AS count FROM public.participant_identities`;
        await assert.rejects(service.createEventParticipant({ ...scope, displayName: "MANUAL SINGER" }), hasPublicError(409, "SESSION_NICKNAME_TAKEN"));
        const [afterConflict] = await sql`SELECT count(*)::integer AS count FROM public.participant_identities`;
        assert.equal(afterConflict.count, identityCount.count, "Conflicting creation rolls back the new identity");
        const sameNickOtherEvent = await service.createEventParticipant({ ...otherScope, displayName: "Manual Singer" });
        assert.notEqual(sameNickOtherEvent.participant.id, manual.participant.id);
        assert.equal((await service.getEventParticipant({ ...otherScope, participantId: sameNickOtherEvent.participant.id })).requests.length, 0);
        const counterRequest = await service.createOperatorParticipantRequest({ ...otherScope, participantId: sameNickOtherEvent.participant.id, songId: fixture.songId });
        await action({ ...otherScope, requestId: counterRequest.request.id, action: "approve" });
        await action({ ...otherScope, requestId: counterRequest.request.id, action: "done" });
        assert.equal((await service.listEventParticipants(otherScope)).items[0].completedCount, 1);
        await action({ ...otherScope, requestId: counterRequest.request.id, action: "restore" });
        const restoredStats = (await service.listEventParticipants(otherScope)).items[0];
        assert.equal(restoredStats.completedCount, 1, "Restoring a request preserves its confirmed performance");
        assert.equal(restoredStats.hasPerformed, false);
        assert.equal(restoredStats.activeCount, 1);
        await assert.rejects(service.getEventParticipant({ ...scope, participantId: sameNickOtherEvent.participant.id }), hasPublicError(404, "EVENT_PARTICIPANT_NOT_FOUND"));
        await assert.rejects(service.createOperatorParticipantRequest({ ...scope, participantId: sameNickOtherEvent.participant.id, songId: fixture.songId }), hasPublicError(404, "EVENT_PARTICIPANT_NOT_FOUND"));
        await assert.rejects(service.listEventParticipants(missingScope), hasPublicError(404, "EVENT_NOT_FOUND"));
        await assert.rejects(service.listEventParticipants(foreignScope), hasPublicError(404, "EVENT_NOT_FOUND"));
        await assert.rejects(service.listEventParticipantPresence(foreignScope), hasPublicError(404, "EVENT_NOT_FOUND"));
        await assert.rejects(service.listEventParticipantPresence(missingScope), hasPublicError(404, "EVENT_NOT_FOUND"));
        assert.equal((await service.listEventParticipantPresence(viewerScope)).items.length, (await service.listEventParticipants(viewerScope)).items.length);
        await assert.rejects(service.createEventParticipant({ ...foreignScope, displayName: "Foreign attempt" }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
        await assert.rejects(service.createOperatorParticipantRequest({ ...foreignScope, participantId: manual.participant.id, songId: fixture.songId }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
        await assert.rejects(service.createEventParticipant({ ...missingScope, displayName: "Foreign" }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
        assert.equal((await service.listEventParticipants(viewerScope)).canManage, false);
        await assert.rejects(service.createEventParticipant({ ...viewerScope, displayName: "Viewer mutation" }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
        await assert.rejects(service.createOperatorParticipantRequest({ ...viewerScope, participantId: manual.participant.id, songId: fixture.songId }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
        const requestInput = { ...scope, participantId: manual.participant.id };
        const first = await service.createOperatorParticipantRequest({ ...requestInput, songId: fixture.songId });
        await assert.rejects(service.createOperatorParticipantRequest({ ...requestInput, songId: fixture.songId }), hasPublicError(409, "QUEUE_ACTIVE_DUPLICATE"));
        const second = await service.createOperatorParticipantRequest({ ...requestInput, songId: fixture.secondSongId });
        await assert.rejects(service.createOperatorParticipantRequest({ ...requestInput, songId: thirdSong.id }), hasPublicError(409, "SESSION_REQUEST_LIMIT_REACHED"));
        await assert.rejects(service.createOperatorParticipantRequest({ ...requestInput, songId: 9_999_999 }), hasPublicError(404, "SONG_NOT_FOUND"));
        const [stored] = await sql<{ requested_by: string; created_by_operator_id: number; event_participant_id: number }[]>`
          SELECT requested_by, created_by_operator_id::integer, event_participant_id::integer FROM public.song_requests WHERE id = ${first.request.id}
        `;
        assert.equal(stored.requested_by, "operator");
        assert.equal(stored.event_participant_id, manual.participant.id);
        assert.ok(stored.created_by_operator_id);
        await action({ ...scope, requestId: first.request.id, action: "approve" });
        await action({ ...scope, requestId: first.request.id, action: "start" });
        let stats = (await service.listEventParticipants(scope)).items.find(({ id }) => id === manual.participant.id)!;
        assert.equal(stats.activeCount, 2); assert.equal(stats.completedCount, 0); assert.equal(stats.hasPerformed, true);
        await action({ ...scope, requestId: first.request.id, action: "done" });
        stats = (await service.listEventParticipants(scope)).items.find(({ id }) => id === manual.participant.id)!;
        assert.equal(stats.activeCount, 1); assert.equal(stats.completedCount, 1);
        await service.createOperatorParticipantRequest({ ...requestInput, songId: thirdSong.id });
        await assert.rejects(action({ ...scope, requestId: first.request.id, action: "restore" }), hasPublicError(409, "SESSION_REQUEST_LIMIT_REACHED"));
        // Reactivation must reject same-song duplicates for operator records too.
        await action({ ...scope, requestId: second.request.id, action: "approve" });
        await action({ ...scope, requestId: second.request.id, action: "done" });
        await service.createOperatorParticipantRequest({ ...requestInput, songId: fixture.songId });
        await assert.rejects(action({ ...scope, requestId: first.request.id, action: "restore" }), hasPublicError(409, "QUEUE_ACTIVE_DUPLICATE"));
        await service.createOperatorParticipantRequest({ ...scope, participantId: mobile.id, songId: fixture.songId });
        const ownOperatorRequest = (await publicService.getPublicParticipantRequests(fixture.tokenA, joined.credential))[0];
        assert.equal(ownOperatorRequest.canCancel, false);
        await assert.rejects(publicService.cancelPublicParticipantRequest(fixture.tokenA, joined.credential, ownOperatorRequest.id), hasPublicError(404, "SESSION_REQUEST_NOT_FOUND"));
        let release = () => {}; let signalReady = () => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const ready = new Promise<void>((resolve) => { signalReady = resolve; });
        const blocker = sql.begin(async (tx) => {
          await tx`SELECT id FROM public.event_sessions WHERE id = ${fixture.sessionA} FOR NO KEY UPDATE`;
          signalReady(); await gate;
        });
        await ready;
        const race = Promise.allSettled([
          publicService.createPublicSessionRequest(fixture.tokenA, joined.credential, { songId: fixture.secondSongId }),
          service.createOperatorParticipantRequest({ ...scope, participantId: mobile.id, songId: thirdSong.id }),
        ]);
        try {
          let waiting = 0;
          const deadline = Date.now() + 1500;
          while (waiting < 2 && Date.now() < deadline) {
            const [row] = await sql`SELECT count(*)::integer AS count FROM pg_stat_activity
              WHERE wait_event_type = 'Lock' AND query LIKE '%event_sessions%' AND datname = current_database()`;
            waiting = row.count;
            if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(waiting, 2);
        } finally { release(); await blocker; }
        const results = await race;
        assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
        for (const result of results) if (result.status === "rejected") assert.ok(hasPublicError(409, "SESSION_REQUEST_LIMIT_REACHED")(result.reason));
        assert.equal((await service.getEventParticipant({ ...scope, participantId: mobile.id })).requests.length, 2);
        await publicService.renamePublicSessionParticipant(fixture.tokenA, joined.credential, { displayName: "New Mobile Nick", normalizedDisplayName: "new mobile nick" });
        assert.equal((await service.getEventParticipant({ ...scope, participantId: mobile.id })).requests.length, 2);
        await assert.rejects(publicService.renamePublicSessionParticipant(fixture.tokenA, joined.credential, { displayName: "Manual Singer", normalizedDisplayName: "manual singer" }), hasPublicError(409, "SESSION_NICKNAME_TAKEN"));
        const [legacy] = await sql<{ id: number }[]>`INSERT INTO public.song_requests
          (event_id, song_id, singer_name, display_name, requested_by, status, position)
          VALUES (${fixture.eventA}, ${fixture.songId}, 'Manual Singer', 'Manual Singer', 'operator', 'done', 0) RETURNING id::integer`;
        assert.equal((await service.getEventParticipant({ ...scope, participantId: manual.participant.id })).requests.length, 4);
        const { getDashboardOrganizationEventQueueForAuthUser } = await import("../../src/server/operator-api/event-queue.ts");
        assert.ok((await getDashboardOrganizationEventQueueForAuthUser(scope))?.items.some(({ id }) => id === legacy.id));
        const audit = await sql`SELECT action, operator_id, payload FROM public.operator_audit_log
          WHERE action IN ('event_participant_created', 'event_participant_request_created')`;
        assert.ok(audit.length >= 5);
        assert.ok(audit.every(({ operator_id }) => Number(operator_id) === stored.created_by_operator_id));
        const broadcasts = await sql<{ payload: Record<string, unknown>; private: boolean; topic: string }[]>`
          SELECT payload, private, topic FROM public.test_participant_broadcasts WHERE event_name = 'participants_changed'`;
        assert.ok(broadcasts.length >= 4);
        for (const broadcast of broadcasts) {
          assert.deepEqual(Object.keys(broadcast.payload).sort(), ["changedAt", "eventId", "operation", "type"]);
          assert.equal(broadcast.private, true);
          assert.match(broadcast.topic, /^dashboard:event:\d+:participants$/);
        }
        const allowed = async (auth: string, topic: string) => sql.begin(async (tx) => {
          await tx`SELECT set_config('request.jwt.claim.sub', ${auth}, true)`;
          await tx.unsafe("SET LOCAL ROLE authenticated");
          const [row] = await tx`SELECT private.can_receive_event_participants(${topic}) AS allowed`;
          return row.allowed;
        });
        assert.equal(await allowed(fixture.authUserId, `dashboard:event:${fixture.eventA}:participants`), true);
        assert.equal(await allowed(viewerAuth, `dashboard:event:${fixture.eventA}:participants`), true);
        assert.equal(await allowed(randomUUID(), `dashboard:event:${fixture.eventA}:participants`), false);
        assert.equal(await allowed(fixture.authUserId, `dashboard:event:999999:participants`), false);
        assert.equal(await allowed(fixture.authUserId, `dashboard:event:${foreignEvent.id}:participants`), false);
        assert.equal(await allowed(fixture.authUserId, `dashboard:event:${fixture.eventA}:queue`), false);
        await sql.unsafe(`CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
          $$ SELECT current_setting('test.realtime.topic', true) $$;
          GRANT USAGE ON SCHEMA realtime TO authenticated, anon;
          GRANT SELECT ON realtime.messages TO authenticated, anon;
          INSERT INTO realtime.messages (extension) VALUES ('broadcast');`);
        const visibleMessages = async (auth: string, topic: string, role: "authenticated" | "anon" = "authenticated") => sql.begin(async (tx) => {
          await tx`SELECT set_config('request.jwt.claim.sub', ${auth}, true), set_config('test.realtime.topic', ${topic}, true)`;
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          const [row] = await tx`SELECT count(*)::integer AS count FROM realtime.messages`;
          return row.count;
        });
        const ownTopic = `dashboard:event:${fixture.eventA}:participants`;
        assert.equal(await visibleMessages(fixture.authUserId, ownTopic), 1);
        assert.equal(await visibleMessages(viewerAuth, ownTopic), 1);
        assert.equal(await visibleMessages(fixture.authUserId, `dashboard:event:${foreignEvent.id}:participants`), 0);
        assert.equal(await visibleMessages(fixture.authUserId, ownTopic, "anon"), 0);
        await sql`UPDATE public.operator_users SET suspended_at = now(), suspension_reason = 'Test suspension',
          suspended_by_operator_id = ${stored.created_by_operator_id} WHERE id = ${viewer.id}`;
        assert.equal(await visibleMessages(viewerAuth, ownTopic), 0);
        await sql`UPDATE public.operator_users SET suspended_at = null, suspension_reason = null,
          suspended_by_operator_id = null WHERE id = ${viewer.id}`;
        await sql`UPDATE public.workspace_members SET active = false WHERE operator_user_id = ${viewer.id}`;
        assert.equal(await visibleMessages(viewerAuth, ownTopic), 0);
        const [privileges] = await sql`SELECT
          has_function_privilege('anon', 'private.can_receive_event_participants(text)', 'EXECUTE') AS anon,
          has_function_privilege('authenticated', 'private.broadcast_event_participants_changed()', 'EXECUTE') AS client_trigger`;
        assert.equal(privileges.anon, false); assert.equal(privileges.client_trigger, false);
      });
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });
}

test("postgres:17-alpine: presence leases, races, retention, privacy and isolation", async () => {
  const harness = await startPostgresTestHarness("pozanuta-presence", "postgres:17-alpine");
  const sql = createPostgresTestClient(harness, "postgres", 16);
  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, 29);
    await applyPostgresMigration(sql, 30);
    await applyPostgresMigration(sql, 32);
    await applyPostgresMigration(sql, 33);
    const [{ version }] = await sql`select current_setting('server_version_num')::integer as version`;
    assert.ok(version >= 170000 && version < 180000);
    const fixture = await seedFixture(sql, 6);
    await sql.unsafe(`CREATE TABLE public.test_presence_broadcasts (payload jsonb, event_name text, topic text, private boolean);
      CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event_name text, topic_name text, private_channel boolean)
      RETURNS void LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO public.test_presence_broadcasts VALUES (payload, event_name, topic_name, private_channel);
      END; $$;`);
    await withApplicationDatabase(harness, async () => {
      const { mutateParticipantPresence: mutate, getEventPresence } = await import("../../src/server/session-api/presence.ts");
      const service = await import("../../src/server/session-api/service.ts");
      const operator = await import("../../src/server/operator-api/event-participants.ts");
      const scope = { authUserId: fixture.authUserId, organizationId: fixture.organizationId, eventId: fixture.eventPublicIdA };
      const join = (name: string) => service.joinPublicSession(fixture.tokenA, null, { displayName: name, normalizedDisplayName: name.toLowerCase() });
      const a = await join("Presence Singer");
      const b = await join("Other Singer");
      const [member] = await sql`select ep.id::integer as id, ep.participant_id::integer as identity_id, pc.id::integer as credential_id
        from public.event_participants ep join public.participant_credentials pc on pc.participant_id = ep.participant_id
        where ep.display_name = 'Presence Singer'`;
      const tab1 = randomUUID(), tab2 = randomUUID();
      const beat = (id: string, action: "connect" | "heartbeat" | "disconnect" = "connect", credential = a.credential, token = fixture.tokenA) => mutate(token, credential, { connectionId: id, action });
      const online = async () => !!(await getEventPresence(fixture.eventA)).byId.get(member.id);
      assert.equal(await online(), false);
      const countRows = async (table: "song_requests" | "event_participants") => Number((await sql.unsafe(`select count(*)::integer as count from public.${table}`))[0].count);
      const requestsBefore = await countRows("song_requests"), membersBefore = await countRows("event_participants");
      assert.equal((await beat(tab1)).online, true);
      await beat(tab1); await beat(tab2);
      assert.equal((await operator.listEventParticipants(scope)).items.find(p => p.id === member.id)?.online, true);
      assert.equal(Number((await sql`select count(*)::integer as count from public.participant_connections where event_participant_id = ${member.id}`)[0].count), 2);
      const countBroadcasts = async () => Number((await sql`select count(*)::integer as count from public.test_presence_broadcasts where event_name = 'participants_changed'`)[0].count);
      // Exercise actual lease renewal, not just the <5s duplicate suppression.
      await sql`update public.participant_connections set created_at = clock_timestamp() - interval '20 seconds',
        heartbeat_at = clock_timestamp() - interval '10 seconds', expires_at = clock_timestamp() + interval '30 seconds'
        where id = ${tab1}`;
      const broadcastCount = await countBroadcasts();
      await Promise.all([beat(tab1, "heartbeat"), beat(tab1, "heartbeat")]);
      assert.equal(await countBroadcasts(), broadcastCount, "Unchanged heartbeat must not broadcast");
      const [renewal] = await sql`select heartbeat_at > clock_timestamp() - interval '5 seconds' as fresh,
        extract(epoch from (expires_at - heartbeat_at)) * 1000 as ttl_ms from public.participant_connections where id = ${tab1}`;
      assert.equal(renewal.fresh, true); assert.equal(Number(renewal.ttl_ms), 40_000);
      assert.equal((await beat(tab1, "disconnect")).online, true);
      assert.equal((await beat(tab1, "disconnect")).online, true);
      assert.equal((await beat(tab2, "disconnect")).online, false);
      await assert.rejects(beat(tab1, "heartbeat"), hasPublicError(409, "SESSION_CONNECTION_ENDED"));
      const reconnect = randomUUID(); await beat(reconnect); await beat(tab2, "disconnect");
      assert.equal(await online(), true, "Late disconnect cannot close a new tab");
      const reordered = randomUUID(); await beat(reordered, "disconnect");
      await assert.rejects(beat(reordered), hasPublicError(409, "SESSION_CONNECTION_ENDED"));
      const raced = await Promise.allSettled([beat(reconnect, "heartbeat"), beat(reconnect, "disconnect")]);
      assert.equal(raced[1].status, "fulfilled");
      if (raced[0].status === "rejected") assert.ok(hasPublicError(409, "SESSION_CONNECTION_ENDED")(raced[0].reason));
      assert.equal(await online(), false, "Disconnect wins either serialization order");
      await beat(randomUUID());
      assert.equal(await countRows("event_participants"), membersBefore, "Heartbeat never creates a participant");
      // Controlled SQL lease clock: no timing sleeps in TTL/domain assertions.
      await sql`update public.participant_connections set created_at = now() - interval '2 minutes',
        heartbeat_at = now() - interval '1 minute', expires_at = now() - interval '1 second' where event_participant_id = ${member.id}`;
      assert.equal(await online(), false, "No beacon: TTL alone expires leases");
      const renewed = randomUUID(); await beat(renewed);
      await assert.rejects(beat(renewed, "heartbeat", b.credential), hasPublicError(403, "SESSION_PARTICIPANT_REQUIRED"));
      await assert.rejects(beat(randomUUID(), "connect", a.credential, fixture.tokenB), hasPublicError(403, "SESSION_PARTICIPANT_REQUIRED"));
      await assert.rejects(beat(randomUUID(), "connect", "invalid"), hasPublicError(403, "SESSION_PARTICIPANT_REQUIRED"));
      const manual = await operator.createEventParticipant({ ...scope, displayName: "Manual Presence" });
      assert.equal((await operator.listEventParticipants(scope)).items.find(p => p.id === manual.participant.id)?.online, false);
      const { generateParticipantCredential, hashParticipantCredential } = await import("../../src/server/session-api/participant-credential.ts");
      const deviceCredential = generateParticipantCredential();
      await sql`insert into public.participant_credentials (participant_id, token_hash, expires_at, last_used_at)
        values (${member.identity_id}, ${hashParticipantCredential(deviceCredential)}, now() + interval '1 day', now())`;
      const deviceTab = randomUUID(); await beat(deviceTab, "connect", deviceCredential); await beat(renewed, "disconnect");
      assert.equal(await online(), true, "Credentials of one verified identity aggregate");
      await sql`update public.participant_credentials set revoked_at = now() where token_hash = ${hashParticipantCredential(deviceCredential)}`;
      assert.equal(await online(), false);
      await assert.rejects(beat(deviceTab, "heartbeat", deviceCredential), hasPublicError(403, "SESSION_PARTICIPANT_REQUIRED"));
      await sql`update public.participant_credentials set expires_at = now() - interval '1 millisecond' where id = ${member.credential_id}`;
      await assert.rejects(beat(randomUUID()), hasPublicError(403, "SESSION_PARTICIPANT_REQUIRED"));
      await sql`update public.participant_credentials set expires_at = now() + interval '1 day' where id = ${member.credential_id}`;
      await sql`update public.participant_connections set created_at = now() - interval '3 days',
        heartbeat_at = now() - interval '2 days', expires_at = now() - interval '25 hours' where event_participant_id = ${member.id}`;
      await beat(randomUUID());
      assert.equal(Number((await sql`select count(*)::integer as count from public.participant_connections where expires_at < now() - interval '24 hours'`)[0].count), 0);
      const people = await Promise.all(Array.from({ length: 40 }, (_, i) => join(`Load Singer ${i}`)));
      const start = performance.now();
      await Promise.all(people.flatMap(p => [randomUUID(), randomUUID()].map(connectionId => mutate(fixture.tokenA, p.credential, { connectionId, action: "connect" }))));
      const snapshot = await operator.listEventParticipants(scope);
      assert.equal(snapshot.items.filter(p => p.online).length, 41);
      assert.ok(performance.now() - start < 30_000, "80 concurrent leases complete within 30s");
      assert.ok(snapshot.nextPresenceCheckAt);
      assert.equal(await countRows("song_requests"), requestsBefore);
      for (let i = 0; i < 32; i++) await beat(randomUUID(), "disconnect", b.credential);
      await assert.rejects(beat(randomUUID(), "disconnect", b.credential), hasPublicError(429, "SESSION_RATE_LIMITED"));
      let release!: () => void; let locked!: () => void;
      const gate = new Promise<void>(resolve => { locked = resolve; });
      const hold = new Promise<void>(resolve => { release = resolve; });
      const blocker = sql.begin(async tx => { await tx`select id from public.event_sessions where id = ${fixture.sessionA} for no key update`; locked(); await hold; });
      await gate;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([beat(randomUUID()), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Presence waited for queue mutex")), 3000); })]); }
      finally { clearTimeout(timeout); release(); await blocker; }
      for (const role of ["anon", "authenticated"] as const) {
        const [privilege] = await sql`select has_table_privilege(${role}, 'public.participant_connections', 'SELECT') as readable,
          has_table_privilege(${role}, 'public.participant_connections', 'INSERT') as writable`;
        assert.equal(privilege.readable, false); assert.equal(privilege.writable, false);
        await sql.unsafe(`grant select, insert, update, delete on public.participant_connections to ${role}`);
        await sql.begin(async tx => {
          await tx.unsafe(`set local role ${role}`);
          assert.equal(Number((await tx`select count(*)::integer as count from public.participant_connections`)[0].count), 0);
        });
        await assert.rejects(sql.begin(async tx => {
          await tx.unsafe(`set local role ${role}`);
          await tx`insert into public.participant_connections (id,event_participant_id,credential_id,expires_at)
            values (${randomUUID()},${member.id},${member.credential_id},now()+interval '40 seconds')`;
        }), /row-level security/);
      }
      for (const row of await sql`select payload, topic, private from public.test_presence_broadcasts where event_name = 'participants_changed'`) {
        assert.deepEqual(Object.keys(row.payload).sort(), ["changedAt", "eventId", "operation", "type"]);
        assert.equal(row.private, true); assert.match(row.topic, /^dashboard:event:\d+:participants$/);
      }
      await sql`update public.events set status = 'closed', closed_at = now(), close_reason = 'manual' where id = ${fixture.eventA}`;
      assert.equal((await getEventPresence(fixture.eventA)).nextPresenceCheckAt, null);
      await assert.rejects(beat(randomUUID()), hasPublicError(403, "SESSION_EVENT_CLOSED"));
    });
  } finally { await sql.end({ timeout: 5 }); await removePostgresTestHarness(harness.containerName); }
});

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

test("postgres:17-alpine: Slice 4 linking, explicit proof, replay, expiry, separate credentials and RLS", async () => {
  await withSlice4Fixture("linking", async (sql, fixture) => {
    const service = await import("../../src/server/session-api/service.ts");
    const link = await import("../../src/server/session-api/linking.ts");
    const { mutateParticipantPresence, getEventPresence } = await import("../../src/server/session-api/presence.ts");
    const { generateParticipantCredential } = await import("../../src/server/session-api/participant-credential.ts");
    const a = await service.joinPublicSession(fixture.tokenA, null, { displayName: "Link Owner", normalizedDisplayName: "link owner" });
    await service.createPublicSessionRequest(fixture.tokenA, a.credential, { songId: fixture.songId });
    await service.createPublicSessionRequest(fixture.tokenA, a.credential, { songId: fixture.secondSongId });
    const invitation = await link.issueDeviceLink(fixture.tokenA, a.credential);
    const receiver = await link.prepareDeviceLink(fixture.tokenA, null, invitation.token, undefined);
    await assert.rejects(link.prepareDeviceLink(fixture.tokenA, null, invitation.token, undefined), hasPublicError(409, "SESSION_LINK_ALREADY_CLAIMED"));
    await assert.rejects(link.prepareDeviceLink(fixture.tokenB, null, invitation.token, undefined), hasPublicError(409, "SESSION_LINK_INVALID"));
    await assert.rejects(link.prepareDeviceLink(fixture.tokenA, null, generateParticipantCredential(), undefined), hasPublicError(409, "SESSION_LINK_INVALID"));
    await assert.rejects(link.finishDeviceLink(fixture.tokenA, null, receiver.link.id, receiver.challenge), hasPublicError(409, "SESSION_LINK_APPROVAL_REQUIRED"));
    await assert.rejects(link.finishDeviceLink(fixture.tokenA, null, receiver.link.id, generateParticipantCredential()), hasPublicError(409, "SESSION_LINK_INVALID"));
    const wrong = receiver.link.comparisonCode === "000000" ? "111111" : "000000";
    await assert.rejects(link.approveDeviceLink(fixture.tokenA, a.credential, receiver.link.id, wrong), hasPublicError(409, "SESSION_LINK_CONFIRMATION_MISMATCH"));
    assert.equal((await sql`select approval_attempts from public.participant_device_links where id = ${receiver.link.id}`)[0].approval_attempts, 1);
    await link.approveDeviceLink(fixture.tokenA, a.credential, receiver.link.id, receiver.link.comparisonCode);
    const results = await Promise.all([link.finishDeviceLink(fixture.tokenA, null, receiver.link.id, receiver.challenge), link.finishDeviceLink(fixture.tokenA, null, receiver.link.id, receiver.challenge)]);
    assert.equal(results[0].credential, results[1].credential, "Bound retries recover the same credential, never mint two");
    assert.notEqual(results[0].credential, a.credential);
    assert.equal(Number((await sql`select count(*) as count from public.participant_credentials`)[0].count), 2);
    assert.equal(Number((await sql`select count(*) as count from public.event_participants`)[0].count), 1);
    const b = results[0].credential;
    assert.deepEqual(await service.getPublicParticipantRequests(fixture.tokenA, a.credential), await service.getPublicParticipantRequests(fixture.tokenA, b));
    const [{ id: third }] = await sql`insert into public.songs (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text) values ('manual', 'third-link', 'Third', 'Artist', 'third', 'artist', 'third artist') returning id::integer`;
    await assert.rejects(service.createPublicSessionRequest(fixture.tokenA, b, { songId: third }), hasPublicError(409, "SESSION_REQUEST_LIMIT_REACHED"));
    await assert.rejects(link.prepareDeviceLink(fixture.tokenA, null, invitation.token, undefined), hasPublicError(409, "SESSION_LINK_USED"));
    const firstConnection = randomUUID(), secondConnection = randomUUID();
    await mutateParticipantPresence(fixture.tokenA, a.credential, { connectionId: firstConnection, action: "connect" });
    await mutateParticipantPresence(fixture.tokenA, b, { connectionId: secondConnection, action: "connect" });
    assert.equal((await getEventPresence(fixture.eventA)).byId.size, 1);
    await mutateParticipantPresence(fixture.tokenA, b, { connectionId: secondConnection, action: "disconnect" });
    assert.equal((await getEventPresence(fixture.eventA)).byId.size, 1);
    const secretRows = JSON.stringify(await sql`select * from public.participant_device_links`);
    for (const secret of [invitation.token, receiver.challenge, a.credential, b]) assert.ok(!secretRows.includes(secret), "No raw secret in link storage");
    for (const role of ["anon", "authenticated"] as const) {
      const [{ rls, privilege }] = await sql`select c.relrowsecurity as rls, has_table_privilege(${role}, c.oid, 'SELECT') as privilege from pg_class c where c.oid = 'public.participant_device_links'::regclass`;
      assert.equal(rls, true); assert.equal(privilege, false);
      for (const table of ["participant_device_links", "participant_merge_proposals"] as const) await assert.rejects(sql.begin(async tx => { await tx.unsafe(`set local role ${role}`); await tx.unsafe(`select * from public.${table}`); }), (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "42501");
    }
    const raceInvitation = await link.issueDeviceLink(fixture.tokenA, a.credential);
    const claims = await Promise.allSettled([link.prepareDeviceLink(fixture.tokenA, null, raceInvitation.token, undefined), link.prepareDeviceLink(fixture.tokenA, null, raceInvitation.token, undefined)]);
    assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
    const expiring = await link.issueDeviceLink(fixture.tokenA, a.credential);
    const expiringReceiver = await link.prepareDeviceLink(fixture.tokenA, null, expiring.token, undefined);
    await link.approveDeviceLink(fixture.tokenA, a.credential, expiring.link.id, expiringReceiver.link.comparisonCode);
    // Hold a real row lock while expiring the token; finish must recheck the
    // database clock after its lock wait rather than use transaction start time.
    await blockedSlice4Race(sql, async tx => {
      await tx`update public.participant_device_links set created_at = clock_timestamp() - interval '4 minutes', expires_at = clock_timestamp() - interval '1 second' where id = ${expiring.link.id}`;
    }, [() => link.finishDeviceLink(fixture.tokenA, null, expiring.link.id, expiringReceiver.challenge)], "participant_device_links", results => {
      assert.equal(results[0].status, "rejected");
      if (results[0].status === "rejected") assert.ok(hasPublicError(409, "SESSION_LINK_EXPIRED")(results[0].reason));
    });
    const locked = await link.issueDeviceLink(fixture.tokenA, a.credential);
    const lockedReceiver = await link.prepareDeviceLink(fixture.tokenA, null, locked.token, undefined);
    for (let i = 0; i < 5; i++) await assert.rejects(link.approveDeviceLink(fixture.tokenA, a.credential, locked.link.id, lockedReceiver.link.comparisonCode === "000000" ? "111111" : "000000"), hasPublicError(409, "SESSION_LINK_CONFIRMATION_MISMATCH"));
    await assert.rejects(link.approveDeviceLink(fixture.tokenA, a.credential, locked.link.id, lockedReceiver.link.comparisonCode), hasPublicError(429, "SESSION_RATE_LIMITED"));
    const foreign = await service.joinPublicSession(fixture.tokenA, null, { displayName: "Other Owner", normalizedDisplayName: "other owner" });
    await assert.rejects(link.prepareDeviceLink(fixture.tokenA, foreign.credential, locked.token, undefined), hasPublicError(409, "SESSION_LINK_IDENTITY_CONFLICT"));
    await assert.rejects(link.approveDeviceLink(fixture.tokenA, foreign.credential, locked.link.id, lockedReceiver.link.comparisonCode), hasPublicError(409, "SESSION_LINK_INVALID"));
    await assert.rejects(link.issueDeviceLink(fixture.tokenA, null), hasPublicError(403, "SESSION_PARTICIPANT_REQUIRED"));
    await link.issueDeviceLink(fixture.tokenA, b);
    await link.issueDeviceLink(fixture.tokenA, a.credential);
    await assert.rejects(link.issueDeviceLink(fixture.tokenA, b), hasPublicError(429, "SESSION_RATE_LIMITED"));
  });
});

test("postgres:17-alpine: Slice 4 manual claim, two-owner merge, history, event scope, Presence and audit", async () => {
  await withSlice4Fixture("merge", async (sql, fixture) => {
    const service = await import("../../src/server/session-api/service.ts");
    const operator = await import("../../src/server/operator-api/event-participants.ts");
    const merge = await import("../../src/server/operator-api/participant-merge.ts");
    const link = await import("../../src/server/session-api/linking.ts");
    const { mutateParticipantPresence: presence, getEventPresence } = await import("../../src/server/session-api/presence.ts");
    const { applyDashboardOrganizationEventQueueActionForAuthUser: action } = await import("../../src/server/operator-api/event-queue.ts");
    const scope = { authUserId: fixture.authUserId, organizationId: fixture.organizationId, eventId: fixture.eventPublicIdA };
    const join = (name: string) => service.joinPublicSession(fixture.tokenA, null, { displayName: name, normalizedDisplayName: name.toLowerCase() });
    const a = await join("Owner A"), b = await join("Owner B"), outsider = await join("Outsider");
    await service.joinPublicSession(fixture.tokenB, a.credential, { displayName: "A Other Event", normalizedDisplayName: "a other event" });
    await service.joinPublicSession(fixture.tokenB, b.credential, { displayName: "B Other Event", normalizedDisplayName: "b other event" });
    const members = await operator.listEventParticipants(scope);
    const aId = members.items.find(p => p.displayName === "Owner A")!.id, bId = members.items.find(p => p.displayName === "Owner B")!.id;
    const manual = (await operator.createEventParticipant({ ...scope, displayName: "Dima Manual" })).participant.id;
    const historic = await operator.createOperatorParticipantRequest({ ...scope, participantId: manual, songId: fixture.songId });
    await action({ ...scope, requestId: historic.request.id, action: "approve" });
    await action({ ...scope, requestId: historic.request.id, action: "start" });
    await action({ ...scope, requestId: historic.request.id, action: "done" });
    await operator.createOperatorParticipantRequest({ ...scope, participantId: manual, songId: fixture.secondSongId });
    const [before] = await sql`select to_jsonb(sr) - 'event_participant_id' as data from public.song_requests sr where id = ${historic.request.id}`;
    const proposal = await merge.createParticipantMergeProposal({ ...scope, sourceId: manual, targetId: aId });
    assert.equal(proposal.sourceConsentRequired, false); assert.equal(proposal.source.requests.length, 2);
    await assert.rejects(merge.completeParticipantMerge({ ...scope, proposalId: proposal.id, action: "complete" }), hasPublicError(409, "PARTICIPANT_MERGE_CONSENT_REQUIRED"));
    await assert.rejects(merge.consentParticipantMerge(fixture.tokenA, outsider.credential, proposal.id, true), hasPublicError(403, "PARTICIPANT_MERGE_FORBIDDEN"));
    await assert.rejects(merge.consentParticipantMerge(fixture.tokenB, a.credential, proposal.id, true), hasPublicError(404, "PARTICIPANT_MERGE_NOT_FOUND"));
    await merge.consentParticipantMerge(fixture.tokenA, a.credential, proposal.id, true);
    const completed = await merge.completeParticipantMerge({ ...scope, proposalId: proposal.id, action: "complete" });
    assert.equal(completed.targetParticipantId, aId);
    assert.deepEqual(await merge.completeParticipantMerge({ ...scope, proposalId: proposal.id, action: "complete" }), completed, "Lost final response is idempotent");
    assert.deepEqual((await sql`select to_jsonb(sr) - 'event_participant_id' as data from public.song_requests sr where id = ${historic.request.id}`)[0], before);
    assert.equal((await operator.getEventParticipant({ ...scope, participantId: manual })).participant.id, aId);
    assert.equal((await service.getPublicParticipantRequests(fixture.tokenA, a.credential)).length, 2);
    assert.equal((await operator.listEventParticipants(scope)).items.some(p => p.id === manual), false);
    assert.equal((await operator.listEventParticipants(scope)).items.find(p => p.id === aId)?.completedCount, 1);
    const ca = randomUUID(), cb = randomUUID();
    await presence(fixture.tokenA, a.credential, { action: "connect", connectionId: ca });
    await presence(fixture.tokenA, b.credential, { action: "connect", connectionId: cb });
    const both = await merge.createParticipantMergeProposal({ ...scope, sourceId: aId, targetId: bId });
    assert.equal(both.sourceConsentRequired, true);
    await merge.consentParticipantMerge(fixture.tokenA, b.credential, both.id, true);
    await assert.rejects(merge.completeParticipantMerge({ ...scope, proposalId: both.id, action: "complete" }), hasPublicError(409, "PARTICIPANT_MERGE_CONSENT_REQUIRED"));
    await merge.consentParticipantMerge(fixture.tokenA, a.credential, both.id, true);
    await merge.completeParticipantMerge({ ...scope, proposalId: both.id, action: "complete" });
    assert.equal([...(await getEventPresence(fixture.eventA)).byId.values()].filter(Boolean).length, 1);
    assert.ok((await getEventPresence(fixture.eventA)).byId.get(bId));
    assert.equal((await sql`select count(*)::integer as count from public.participant_connections where event_participant_id = ${bId}`)[0].count, 2);
    await presence(fixture.tokenA, a.credential, { action: "heartbeat", connectionId: ca });
    await presence(fixture.tokenA, b.credential, { action: "disconnect", connectionId: cb });
    assert.ok((await getEventPresence(fixture.eventA)).byId.get(bId));
    const aliases = await sql`select merged_into_id::integer from public.event_participants where id in (${manual}, ${aId})`;
    assert.ok(aliases.every(p => p.merged_into_id === bId), "Earlier aliases stay single-hop");
    assert.deepEqual(await service.getPublicSessionParticipant(fixture.tokenA, a.credential), { displayName: "Owner B" });
    assert.deepEqual(await service.getPublicSessionParticipant(fixture.tokenB, a.credential), { displayName: "A Other Event" });
    assert.deepEqual(await service.getPublicSessionParticipant(fixture.tokenB, b.credential), { displayName: "B Other Event" });
    // Event aliases must never become global identity ownership through linking.
    const invitation = await link.issueDeviceLink(fixture.tokenA, a.credential);
    const receiver = await link.prepareDeviceLink(fixture.tokenA, null, invitation.token, undefined);
    await link.approveDeviceLink(fixture.tokenA, a.credential, invitation.link.id, receiver.link.comparisonCode);
    const device = await link.finishDeviceLink(fixture.tokenA, null, invitation.link.id, receiver.challenge);
    assert.deepEqual(await service.getPublicSessionParticipant(fixture.tokenA, device.credential), { displayName: "Owner B" });
    assert.deepEqual(await service.getPublicSessionParticipant(fixture.tokenB, device.credential), { displayName: "A Other Event" });
    const [other] = await sql`select id::integer from public.event_participants where event_session_id <> ${fixture.sessionA} limit 1`;
    await assert.rejects(merge.createParticipantMergeProposal({ ...scope, sourceId: other.id, targetId: bId }), hasPublicError(404, "PARTICIPANT_MERGE_SCOPE"));
    await assert.rejects(merge.createParticipantMergeProposal({ ...scope, organizationId: "foreignworkspace0001", sourceId: aId, targetId: bId }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
    await assert.rejects(sql`update public.event_participants set merged_into_id = ${other.id}, merged_at = now() where id = ${bId}`, (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "23514");
    await assert.rejects(sql`update public.event_participants set merged_into_id = ${aId}, merged_at = now() where id = ${bId}`, (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "23514");
    await sql`update public.workspace_members set role = 'viewer' where operator_user_id in (select id from public.operator_users where auth_user_id = ${fixture.authUserId})`;
    await assert.rejects(merge.createParticipantMergeProposal({ ...scope, sourceId: aId, targetId: bId }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
    await assert.rejects(merge.completeParticipantMerge({ ...scope, proposalId: both.id, action: "complete" }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
    const audit = await sql`select action, payload from public.operator_audit_log where action like 'participant_%'`;
    assert.ok(audit.some(row => row.action === "participant_request_merged"));
    const broadcasts = await sql`select payload, private from public.test_slice4_broadcasts`;
    assert.ok(broadcasts.length > 0); assert.ok(broadcasts.every(row => row.private));
    for (const row of broadcasts) {
      assert.ok(Object.keys(row.payload).every(key => ["eventId", "type", "changedAt", "operation", "reason", "revision"].includes(key)));
      if ("revision" in row.payload) assert.match(row.payload.revision, /^\d{1,19}$/);
    }
    const serialized = JSON.stringify([...audit, ...broadcasts]);
    for (const secret of [a.credential, b.credential, invitation.token, receiver.challenge]) assert.ok(!serialized.includes(secret), "No token in audit or Realtime");
  });
});

test("postgres:17-alpine: Slice 4 real transaction races and conflict policy", async () => {
  if (process.env.SLICE4_MERGE_FAULT_CHILD !== "1") {
    const child = await runFaultProcess({
      args: ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.public-session-postgres.config.ts", "tests/postgres/participantIdentity.integration.test.ts", "-t", "real transaction races and conflict policy", "--silent"],
      env: { SLICE4_MERGE_FAULT_CHILD: "1" }, timeoutMs: 150_000,
      artifact: "slice4-recovery-business-merge-child.log",
    });
    assert.equal(child.timedOut, false, "Merge fault subprocess hung");
    assert.equal(child.signal, null, "Merge fault subprocess signalled");
    assert.equal(child.exitCode, 0, "Merge fault subprocess failed; see .artifacts/slice4-recovery-business-merge-child.log");
    assert.doesNotMatch(child.output, /uncaught|unhandled|TypeError/i);
    return;
  }
  await withSlice4Fixture("merge-races", async (sql, fixture) => {
    const service = await import("../../src/server/session-api/service.ts");
    const operator = await import("../../src/server/operator-api/event-participants.ts");
    const merge = await import("../../src/server/operator-api/participant-merge.ts");
    const { mutateParticipantPresence: presence } = await import("../../src/server/session-api/presence.ts");
    const { applyDashboardOrganizationEventQueueActionForAuthUser: action } = await import("../../src/server/operator-api/event-queue.ts");
    const scope = { authUserId: fixture.authUserId, organizationId: fixture.organizationId, eventId: fixture.eventPublicIdA };
    const [{ id: third }] = await sql`insert into public.songs (source, source_song_id, title, artist, normalized_title, normalized_artist, search_text) values ('manual', 'race-third', 'Third', 'Artist', 'third', 'artist', 'third artist') returning id::integer`;
    let index = 0;
    async function pair() {
      const source = await service.joinPublicSession(fixture.tokenA, null, { displayName: `Source ${++index}`, normalizedDisplayName: `source ${index}` });
      const target = await service.joinPublicSession(fixture.tokenA, null, { displayName: `Target ${index}`, normalizedDisplayName: `target ${index}` });
      const members = (await operator.listEventParticipants(scope)).items;
      const sourceId = members.find(p => p.displayName === `Source ${index}`)!.id, targetId = members.find(p => p.displayName === `Target ${index}`)!.id;
      const proposal = await merge.createParticipantMergeProposal({ ...scope, sourceId, targetId });
      await merge.consentParticipantMerge(fixture.tokenA, source.credential, proposal.id, true);
      await merge.consentParticipantMerge(fixture.tokenA, target.credential, proposal.id, true);
      return { source, target, sourceId, targetId, proposalId: proposal.id };
    }
    const complete = (proposalId: string) => merge.completeParticipantMerge({ ...scope, proposalId, action: "complete" });
    const limit = await pair();
    await operator.createOperatorParticipantRequest({ ...scope, participantId: limit.sourceId, songId: fixture.songId });
    await operator.createOperatorParticipantRequest({ ...scope, participantId: limit.sourceId, songId: fixture.secondSongId });
    await operator.createOperatorParticipantRequest({ ...scope, participantId: limit.targetId, songId: third });
    assert.equal((await merge.getParticipantMergeProposal({ ...scope, proposalId: limit.proposalId })).conflict, "limit");
    await assert.rejects(complete(limit.proposalId), hasPublicError(409, "PARTICIPANT_MERGE_LIMIT"));
    const duplicate = await pair();
    await operator.createOperatorParticipantRequest({ ...scope, participantId: duplicate.sourceId, songId: fixture.songId });
    await operator.createOperatorParticipantRequest({ ...scope, participantId: duplicate.targetId, songId: fixture.songId });
    await assert.rejects(complete(duplicate.proposalId), hasPublicError(409, "PARTICIPANT_MERGE_DUPLICATE"));
    const create = await pair();
    await operator.createOperatorParticipantRequest({ ...scope, participantId: create.sourceId, songId: fixture.songId });
    await operator.createOperatorParticipantRequest({ ...scope, participantId: create.targetId, songId: fixture.secondSongId });
    await blockedSlice4Race(sql, tx => tx`select id from public.event_sessions where id = ${fixture.sessionA} for no key update`.then(() => {}), [() => complete(create.proposalId), () => service.createPublicSessionRequest(fixture.tokenA, create.source.credential, { songId: third })], "event_sessions", results => {
      assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
      for (const result of results) if (result.status === "rejected") assert.ok(["PARTICIPANT_MERGE_LIMIT", "SESSION_REQUEST_LIMIT_REACHED"].some(code => hasPublicError(409, code)(result.reason)));
    });
    const start = await pair();
    const song = await operator.createOperatorParticipantRequest({ ...scope, participantId: start.sourceId, songId: fixture.songId });
    await action({ ...scope, requestId: song.request.id, action: "approve" });
    await blockedSlice4Race(sql, tx => tx`select id from public.event_sessions where id = ${fixture.sessionA} for no key update`.then(() => {}), [() => complete(start.proposalId), () => action({ ...scope, requestId: song.request.id, action: "start" })], "event_sessions", results => assert.ok(results.every(row => row.status === "fulfilled")));
    assert.equal((await sql`select status, event_participant_id::integer from public.song_requests where id = ${song.request.id}`)[0].event_participant_id, start.targetId);
    assert.equal((await sql`select status from public.song_requests where id = ${song.request.id}`)[0].status, "now");
    await action({ ...scope, requestId: song.request.id, action: "done" });
    const rename = await pair();
    const renamed = await Promise.allSettled([complete(rename.proposalId), service.renamePublicSessionParticipant(fixture.tokenA, rename.source.credential, { displayName: "Renamed race", normalizedDisplayName: "renamed race" })]);
    assert.equal(renamed[1].status, "fulfilled");
    if (renamed[0].status === "rejected") assert.ok(hasPublicError(409, "PARTICIPANT_MERGE_STALE")(renamed[0].reason));
    await sql`update public.participant_merge_proposals set created_at = created_at - interval '1 minute', expires_at = expires_at - interval '1 minute'`;
    const heartbeat = await pair();
    const connectionId = randomUUID();
    await presence(fixture.tokenA, heartbeat.source.credential, { action: "connect", connectionId });
    const beating = await Promise.allSettled([complete(heartbeat.proposalId), presence(fixture.tokenA, heartbeat.source.credential, { action: "heartbeat", connectionId })]);
    assert.ok(beating.every(row => row.status === "fulfilled"));
    assert.equal((await sql`select event_participant_id::integer from public.participant_connections where id = ${connectionId}`)[0].event_participant_id, heartbeat.targetId);
    // Database quota is five proposals/minute; advance only the fixture quota
    // timestamps while preserving each TTL constraint and domain clock.
    await sql`update public.participant_merge_proposals set created_at = created_at - interval '1 minute', expires_at = expires_at - interval '1 minute'`;
    const twice = await pair();
    const outcomes = await Promise.all([complete(twice.proposalId), complete(twice.proposalId)]);
    assert.deepEqual(outcomes[0], outcomes[1]);
    assert.equal((await sql`select count(*)::integer as count from public.operator_audit_log where action = 'participant_event_merged' and entity_id = ${twice.proposalId}`)[0].count, 1);
    // Retrying after a response was lost cannot duplicate history or aliases.
    assert.deepEqual(await complete(twice.proposalId), outcomes[0]);
    const competing = await pair();
    const thirdOwner = await service.joinPublicSession(fixture.tokenA, null, { displayName: "Third Owner", normalizedDisplayName: "third owner" });
    const thirdId = (await operator.listEventParticipants(scope)).items.find(p => p.displayName === "Third Owner")!.id;
    const alternate = await merge.createParticipantMergeProposal({ ...scope, sourceId: competing.sourceId, targetId: thirdId });
    await merge.consentParticipantMerge(fixture.tokenA, competing.source.credential, alternate.id, true);
    await merge.consentParticipantMerge(fixture.tokenA, thirdOwner.credential, alternate.id, true);
    const contested = await Promise.allSettled([complete(competing.proposalId), complete(alternate.id)]);
    assert.equal(contested.filter(result => result.status === "fulfilled").length, 1);
    for (const result of contested) if (result.status === "rejected") assert.ok(hasPublicError(409, "PARTICIPANT_MERGE_STALE")(result.reason));
    await sql`update public.participant_merge_proposals set created_at = created_at - interval '1 minute', expires_at = expires_at - interval '1 minute'`;
    for (const disconnect of [false, true]) {
    const interrupted = await pair();
    const retained = await operator.createOperatorParticipantRequest({ ...scope, participantId: interrupted.sourceId, songId: fixture.songId });
    const historic = await operator.createOperatorParticipantRequest({ ...scope, participantId: interrupted.sourceId, songId: fixture.secondSongId });
    await action({ ...scope, requestId: historic.request.id, action: "approve" });
    await action({ ...scope, requestId: historic.request.id, action: "start" });
    await action({ ...scope, requestId: historic.request.id, action: "done" });
    const sourceConnection = randomUUID(), targetConnection = randomUUID();
    await presence(fixture.tokenA, interrupted.source.credential, { action: "connect", connectionId: sourceConnection });
    await presence(fixture.tokenA, interrupted.target.credential, { action: "connect", connectionId: targetConnection });
    const credentials = async () => (await sql`select md5(coalesce(jsonb_agg(to_jsonb(pc) order by pc.id)::text, '[]')) as digest
      from public.participant_credentials pc join public.event_participants ep on ep.participant_id = pc.participant_id
      where ep.id in (${interrupted.sourceId}, ${interrupted.targetId})`)[0].digest;
    const snapshot = async () => ({
      credentials: await credentials(),
      identities: await sql`select to_jsonb(pi) as data from public.participant_identities pi join public.event_participants ep on ep.participant_id = pi.id where ep.id in (${interrupted.sourceId}, ${interrupted.targetId}) order by pi.id`,
      members: await sql`select to_jsonb(ep) as data from public.event_participants ep where id in (${interrupted.sourceId}, ${interrupted.targetId}) order by id`,
      requests: await sql`select to_jsonb(sr) as data from public.song_requests sr where id in (${retained.request.id}, ${historic.request.id}) order by id`,
      presence: await sql`select to_jsonb(pc) as data from public.participant_connections pc where id in (${sourceConnection}, ${targetConnection}) order by id`,
      proposal: await sql`select to_jsonb(p) as data from public.participant_merge_proposals p where id = ${interrupted.proposalId}`,
    });
    const beforeFault = await snapshot();
    const history = (await sql`select to_jsonb(sr) - 'event_participant_id' as data from public.song_requests sr where id = ${historic.request.id}`)[0].data;
    let release!: () => void, ready!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const held = new Promise<void>(resolve => { ready = resolve; });
    const blocker = sql.begin(async tx => { await tx`lock table public.participant_connections in share mode`; ready(); await hold; });
    await held;
    const interruptedResult = Promise.allSettled([complete(interrupted.proposalId)]);
    try {
      let pid: number | null = null;
      const deadline = Date.now() + 2000;
      while (!pid && Date.now() < deadline) {
        const [row] = await sql`select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like 'update "participant_connections"%'`;
        pid = row?.pid ?? null;
        if (!pid) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(pid, "Merge reached Presence reparenting after moving requests inside its transaction");
      if (disconnect) await sql`select pg_terminate_backend(${pid})`;
      else await sql`select pg_cancel_backend(${pid})`;
      assert.equal((await interruptedResult)[0].status, "rejected");
    } finally { release(); await blocker; }
    assert.equal((await sql`select event_participant_id::integer from public.song_requests where id = ${retained.request.id}`)[0].event_participant_id, interrupted.sourceId, "Interrupted merge rolls request ownership back");
    assert.equal((await sql`select merged_into_id from public.event_participants where id = ${interrupted.sourceId}`)[0].merged_into_id, null);
    assert.equal((await sql`select completed_at from public.participant_merge_proposals where id = ${interrupted.proposalId}`)[0].completed_at, null);
    assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(beforeFault), "Fault rolls back requests/history, aliases, Presence, credentials, identities and proposal together");
    await complete(interrupted.proposalId);
    await complete(interrupted.proposalId);
    assert.equal(await credentials(), beforeFault.credentials, "Retry preserves global credentials");
    assert.deepEqual((await sql`select to_jsonb(sr) - 'event_participant_id' as data from public.song_requests sr where id = ${historic.request.id}`)[0].data, history);
    assert.ok((await sql`select event_participant_id::integer as owner from public.song_requests where id in (${retained.request.id}, ${historic.request.id})`).every(row => row.owner === interrupted.targetId));
    assert.ok((await sql`select event_participant_id::integer as owner from public.participant_connections where id in (${sourceConnection}, ${targetConnection})`).every(row => row.owner === interrupted.targetId));
    assert.equal((await sql`select count(*)::integer as count from public.operator_audit_log where action = 'participant_event_merged' and entity_id = ${interrupted.proposalId}`)[0].count, 1);
    }
  });
});

async function withSlice4Fixture(name: string, action: (sql: ReturnType<typeof createPostgresTestClient>, fixture: Awaited<ReturnType<typeof seedFixture>>) => Promise<void>) {
  const harness = await startPostgresTestHarness(`pozanuta-slice4-${name}`, "postgres:17-alpine");
  const sql = createPostgresTestClient(harness, "postgres", 10);
  try {
    await installPostgresCompatibilityFixture(sql);
    await applyPostgresMigrations(sql, 30);
    await applyPostgresMigration(sql, 32);
    await applyPostgresMigration(sql, 33);
    const fixture = await seedFixture(sql, 6);
    await sql.unsafe(`create table public.test_slice4_broadcasts (payload jsonb, private boolean);
      create or replace function realtime.send(payload jsonb, event_name text, topic_name text, private_channel boolean)
      returns void language plpgsql as $$ begin insert into public.test_slice4_broadcasts values (payload, private_channel); end; $$;`);
    await withApplicationDatabase(harness, () => action(sql, fixture));
  } finally { await sql.end({ timeout: 5 }); await removePostgresTestHarness(harness.containerName); }
}

async function blockedSlice4Race(sql: ReturnType<typeof createPostgresTestClient>, lock: (tx: postgres.TransactionSql) => Promise<void>, actions: (() => Promise<unknown>)[], table: string, check: (results: PromiseSettledResult<unknown>[]) => void) {
  let release!: () => void, ready!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { ready = resolve; });
  const blocker = sql.begin(async tx => { await lock(tx); ready(); await hold; });
  await held;
  const race = Promise.allSettled(actions.map(action => action()));
  try {
    let waiting = 0;
    const deadline = Date.now() + 2000;
    while (waiting < actions.length && Date.now() < deadline) {
      const [row] = await sql`select count(*)::integer as count from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database() and query like ${`%${table}%`}`;
      waiting = row.count;
      if (waiting < actions.length) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(waiting, actions.length, "Both real application transactions reached the held lock");
  } finally { release(); await blocker; }
  check(await race);
}

async function seedFixture(sql: ReturnType<typeof createPostgresTestClient>, codeDigits = 8) {
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
        ${workspace.id}, ${input.name}, ${String(index + 1).padStart(codeDigits, "0")},
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
    eventPublicIdB: events[1]!.publicId,
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

async function fairQueueTools(sql: ReturnType<typeof createPostgresTestClient>, fixture: Awaited<ReturnType<typeof seedFixture>>) {
  const service = await import("../../src/server/session-api/service.ts");
  const participants = await import("../../src/server/operator-api/event-participants.ts");
  const queue = await import("../../src/server/operator-api/event-queue.ts");
  const fair = await import("../../src/server/operator-api/fair-queue.ts");
  const merge = await import("../../src/server/operator-api/participant-merge.ts");
  const scope = { authUserId: fixture.authUserId, organizationId: fixture.organizationId, eventId: fixture.eventPublicIdA };
  const action = (id: number, action: "approve" | "start" | "done" | "restore" | "reject") => queue.applyDashboardOrganizationEventQueueActionForAuthUser({ ...scope, requestId: id, action });
  const member = async (name: string, manual = false) => {
    if (manual) return { id: (await participants.createEventParticipant({ ...scope, displayName: name })).participant.id, credential: null };
    const joined = await service.joinPublicSession(fixture.tokenA, null, { displayName: name, normalizedDisplayName: name.toLowerCase() });
    const [row] = await sql`select id::integer from public.event_participants where event_session_id = ${fixture.sessionA} and display_name = ${name}`;
    return { id: Number(row.id), credential: joined.credential };
  };
  const request = async (person: { id: number }, songId = fixture.songId) => (await participants.createOperatorParticipantRequest({ ...scope, participantId: person.id, songId })).request.id;
  const approve = async (person: { id: number }, songId = fixture.songId) => { const id = await request(person, songId); await action(id, "approve"); return id; };
  const ids = async () => (await sql`select id::integer from public.song_requests where event_id = ${fixture.eventA} and status = 'approved' order by position, id`).map(row => Number(row.id));
  const snapshot = async () => sql`select to_jsonb(sr) as data from public.song_requests sr where event_id = ${fixture.eventA} order by id`;
  const move = (id: number, targetPosition: number) => queue.moveDashboardOrganizationEventQueueRequestForAuthUser({ ...scope, requestId: id, move: { targetPosition } });
  const history = async (person: { id: number }, times: number) => {
    for (let i = 0; i < times; i++) { const id = await approve(person); await action(id, "start"); await action(id, "done"); }
  };
  const base = async (distinctThird = false) => {
    const people = [];
    for (const name of ["Fair A", "Fair B", "Fair C", "Fair D", "Fair E"]) people.push(await member(name));
    const [a, b, c] = await Promise.all(people.slice(0, 3).map((person, index) => request(person, distinctThird && index === 2 ? fixture.secondSongId : fixture.songId)));
    for (const id of [a, b, c]) await action(id, "approve");
    await move(c, 1); await move(b, 2);
    const d = await request(people[3]), e = await request(people[4]);
    return { a, b, c, d, e, people };
  };
  return { sql, fixture, scope, service, participants, queue, fair, merge, member, request, approve, ids, snapshot, move, action, history, base };
}
async function withFairQueueFixture(name: string, run: (tools: Awaited<ReturnType<typeof fairQueueTools>>) => Promise<void>) {
  await withSlice4Fixture(`fair-${name}`, async (sql, fixture) => run(await fairQueueTools(sql, fixture)));
}

test("postgres:17-alpine: Slice 5 Fair Insert, explicit preview, history, audit, versions and 2/2", async () => {
  await withFairQueueFixture("contract", async t => {
    const experienced = await t.member("Experienced"), once = await t.member("Once"), newcomer = await t.member("New Singer", true);
    await t.history(experienced, 3); await t.history(once, 1);
    const a = await t.approve(experienced), c = await t.approve(once), b = await t.approve(newcomer);
    assert.deepEqual(await t.ids(), [b, a, c], "Insertion preserves the prior A/C order even when global sort would change it");
    const before = await t.snapshot();
    const preview = await t.fair.previewFairEventQueue(t.scope);
    assert.deepEqual(preview.changes.map(row => row.id), [b, c, a]);
    assert.deepEqual(await t.snapshot(), before, "Preview performs no write");
    const result = await t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision });
    assert.deepEqual(await t.ids(), [b, c, a]);
    assert.deepEqual(result.items.filter(row => row.status === "approved").map(row => row.id), [b, c, a]);
    const [audit] = await t.sql`select operator_id, event_id, created_at, payload from public.operator_audit_log where action = 'event_queue_fair_sort'`;
    assert.equal(Number(audit.event_id), t.fixture.eventA); assert.ok(audit.operator_id); assert.ok(audit.created_at);
    assert.deepEqual(audit.payload, { before: [b, a, c], after: [b, c, a], outcome: "changed", changed: 2, engine: "legacy" });
    const after = await t.snapshot();
    assert.deepEqual(after.filter(row => row.data.status !== "approved"), before.filter(row => row.data.status !== "approved"), "Full sort leaves all history and nonapproved rows unchanged");
    for (const row of after.filter(row => row.data.status === "approved")) {
      const old = before.find(previous => previous.data.id === row.data.id)!.data;
      assert.equal(row.data.version, old.version + Number(row.data.position !== old.position));
    }
    await assert.rejects(t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision }), hasPublicError(409, "FAIR_QUEUE_PREVIEW_STALE"));
    const unchanged = await t.fair.previewFairEventQueue(t.scope);
    assert.equal((await t.fair.applyFairEventQueue({ ...t.scope, revision: unchanged.revision })).changed, 0);
    await assert.rejects(t.fair.applyFairEventQueue({ ...t.scope, revision: unchanged.revision }), hasPublicError(409, "FAIR_QUEUE_PREVIEW_STALE"));
    await t.move(a, 1);
    const next = await t.approve(newcomer, t.fixture.secondSongId);
    assert.deepEqual(await t.ids(), [a, b, c, next], "New approvals preserve the existing manual order");
    await assert.rejects(t.request(newcomer, t.fixture.songId), hasPublicError(409, "QUEUE_ACTIVE_DUPLICATE"));
    const [{ id: thirdSong }] = await t.sql`insert into public.songs(source,source_song_id,title,artist,normalized_title,normalized_artist,search_text)
      values('manual','fair-third','Third','Artist','third','artist','third artist') returning id::integer`;
    await assert.rejects(t.request(newcomer, Number(thirdSong)), hasPublicError(409, "SESSION_REQUEST_LIMIT_REACHED"));
    await t.action(a, "start");
    const followup = await t.approve(experienced, t.fixture.secondSongId);
    assert.notEqual((await t.ids())[0], followup, "Current singer's next song cannot jump to the front");
    const protectedNow = (await t.snapshot()).find(row => row.data.id === a);
    const during = await t.fair.previewFairEventQueue(t.scope);
    await t.fair.applyFairEventQueue({ ...t.scope, revision: during.revision });
    assert.deepEqual((await t.snapshot()).find(row => row.data.id === a), protectedNow);
    const broadcast = JSON.stringify(await t.sql`select payload from public.test_slice4_broadcasts`);
    for (const value of ["Experienced", "Once", "New Singer", t.fixture.tokenA]) assert.ok(!broadcast.includes(value), "Realtime never includes singer or access data");
  });
});

test("postgres:17-alpine: Slice 5 rollback restores positions, versions and audit atomically", async () => {
  await withFairQueueFixture("rollback", async t => {
    const base = await t.base();
    const preview = await t.fair.previewFairEventQueue(t.scope), before = await t.snapshot();
    await t.sql.unsafe(`create function public.test_fail_fair_audit() returns trigger language plpgsql as $$ begin
      if new.action in ('event_queue_fair_sort','event_queue_approve') then raise exception 'fixture fair audit failure'; end if; return new; end $$;
      create trigger test_fail_fair_audit before insert on public.operator_audit_log for each row execute function public.test_fail_fair_audit();`);
    const injectedFailure = (error: unknown) => typeof error === "object" && error !== null && "cause" in error &&
      typeof error.cause === "object" && error.cause !== null && "code" in error.cause && error.cause.code === "P0001";
    await assert.rejects(t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision }), injectedFailure);
    await assert.rejects(t.action(base.d, "approve"), injectedFailure);
    assert.deepEqual(await t.snapshot(), before);
    assert.equal((await t.sql`select count(*)::integer as count from public.operator_audit_log where action = 'event_queue_fair_sort'`)[0].count, 0);
    await t.sql.unsafe(`drop trigger test_fail_fair_audit on public.operator_audit_log`);
    assert.equal((await t.fair.previewFairEventQueue(t.scope)).revision, preview.revision);
    await t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision });
  });
});

test("postgres:17-alpine: Slice 5 viewer, event/workspace isolation and closed queues fail without writes", async () => {
  await withFairQueueFixture("security", async t => {
    await t.base();
    const preview = await t.fair.previewFairEventQueue(t.scope), before = await t.snapshot();
    await assert.rejects(t.fair.applyFairEventQueue({ ...t.scope, eventId: t.fixture.eventPublicIdB, revision: preview.revision }), hasPublicError(409, "FAIR_QUEUE_PREVIEW_STALE"));
    const otherWorkspace = randomUUID().replaceAll("-", "").slice(0, 20);
    const [other] = await t.sql`insert into public.workspaces(name,handle,public_id) values ('Other','other-fair',${otherWorkspace}) returning id`;
    await t.sql`insert into public.workspace_members(workspace_id,operator_user_id,role) select ${other.id},operator_user_id,'owner' from public.workspace_members where workspace_id=(select id from public.workspaces where public_id=${t.scope.organizationId})`;
    await assert.rejects(t.fair.previewFairEventQueue({ ...t.scope, organizationId: otherWorkspace }), hasPublicError(404, "EVENT_NOT_FOUND"));
    await t.sql`update public.workspace_members set role='viewer' where workspace_id=(select id from public.workspaces where public_id=${t.scope.organizationId})`;
    await assert.rejects(t.fair.previewFairEventQueue(t.scope), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
    await assert.rejects(t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision }), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
    await t.sql`update public.workspace_members set role='owner' where workspace_id=(select id from public.workspaces where public_id=${t.scope.organizationId})`;
    await t.sql`update public.events set status='closed',closed_at=clock_timestamp(),close_reason='manual' where id=${t.fixture.eventA}`;
    await assert.rejects(t.fair.previewFairEventQueue(t.scope), hasPublicError(409, "EVENT_QUEUE_CLOSED"));
    await assert.rejects(t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision }), hasPublicError(409, "EVENT_QUEUE_CLOSED"));
    assert.deepEqual(await t.snapshot(), before);
  });
});

test("postgres:17-alpine: Slice 5 legacy null owners and event-scoped merged history", async () => {
  await withFairQueueFixture("legacy-merge", async t => {
    const a = await t.member("Source Owner"), b = await t.member("Target Owner"), c = await t.member("Fresh Owner");
    await t.history(a, 1); await t.history(b, 1);
    await t.sql`update event_participants set display_name='Source Renamed',normalized_display_name='source renamed' where id=${a.id}`;
    const ar = await t.approve(a), cr = await t.approve(c);
    const preview = await t.fair.previewFairEventQueue(t.scope);
    const proposal = await t.merge.createParticipantMergeProposal({ ...t.scope, sourceId: a.id, targetId: b.id });
    await t.merge.consentParticipantMerge(t.fixture.tokenA, a.credential, proposal.id, true);
    await t.merge.consentParticipantMerge(t.fixture.tokenA, b.credential, proposal.id, true);
    await t.merge.completeParticipantMerge({ ...t.scope, proposalId: proposal.id, action: "complete" });
    await assert.rejects(t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision }), hasPublicError(409, "FAIR_QUEUE_PREVIEW_STALE"));
    const fresh = await t.fair.previewFairEventQueue(t.scope);
    assert.deepEqual(fresh.changes.map(row => row.id), [cr, ar]);
    assert.equal((await t.sql`select count(*)::integer as count from public.song_requests where event_participant_id=${b.id} and status='done'`)[0].count, 2);
    const detail=await t.participants.getEventParticipant({...t.scope,participantId:a.id});
    assert.equal(detail.participant.id,b.id);assert.equal(detail.participant.completedCount,2);
    assert.ok(detail.participant.nicknameChanges.some(change=>change.before==='Source Owner'&&change.after==='Source Renamed'));
    assert.ok(detail.requests.every(request=>request.currentDisplayName==='Target Owner'));
    const [legacy] = await t.sql`insert into public.song_requests(event_id,song_id,singer_name,display_name,status,position,requested_by)
      values(${t.fixture.eventA},${t.fixture.songId},'Target Owner','Target Owner','approved',9,'operator') returning id::integer`;
    const fallback = await t.fair.previewFairEventQueue(t.scope);
    assert.deepEqual(fallback.changes.map(row => row.id), [cr, legacy.id, ar], "Same-nickname legacy request has no invented history");
    await t.fair.applyFairEventQueue({ ...t.scope, revision: fallback.revision });
    assert.equal((await t.sql`select event_participant_id from public.song_requests where id=${legacy.id}`)[0].event_participant_id, null);
    const { loadFairQueueSnapshot } = await import("../../src/server/operator-api/fair-queue-store.ts");
    const { getDb } = await import("../../src/server/db.ts");
    const legacyAnchor = await getDb().transaction(tx => loadFairQueueSnapshot(tx, t.fixture.eventA));
    const observed = legacyAnchor.requests.find(row => row.id === legacy.id)!;
    assert.notEqual(observed.waitingSince, null);
    assert.ok(observed.waitingSince! >= observed.createdAt, "Unknown historical approval is anchored when observed, never backdated");
    assert.equal((await t.sql`select count(*)::integer as count from public.operator_audit_log where action='event_queue_fair_anchor' and entity_id=${String(legacy.id)}`)[0].count, 1);
    const again = await t.fair.previewFairEventQueue(t.scope);
    await t.fair.applyFairEventQueue({ ...t.scope, revision: again.revision });
    assert.equal((await t.sql`select count(*)::integer as count from public.operator_audit_log where action='event_queue_fair_anchor' and entity_id=${String(legacy.id)}`)[0].count, 1);
    const snapshots=await t.sql`select id,display_name,singer_name from song_requests where event_id=${t.fixture.eventA} order by id`;
    await t.service.renamePublicSessionParticipant(t.fixture.tokenA,a.credential,{displayName:'Canonical Renamed',normalizedDisplayName:'canonical renamed'});
    const renamed=await t.participants.getEventParticipant({...t.scope,participantId:a.id});assert.equal(renamed.participant.id,b.id);assert.equal(renamed.participant.displayName,'Canonical Renamed');assert.equal(renamed.participant.completedCount,2);
    assert.ok(renamed.participant.nicknameChanges.some(change=>change.before==='Target Owner'&&change.after==='Canonical Renamed'));
    assert.deepEqual(await t.sql`select id,display_name,singer_name from song_requests where event_id=${t.fixture.eventA} order by id`,snapshots);
  });
});

for (const kind of ["approve/approve", "approve/move", "approve/start", "fair/move", "fair/approve", "fair/start", "fair/restore", "merge/fair", "done/fair", "fair/fair"] as const) {
  test(`postgres:17-alpine: Slice 5 real mutex race ${kind}`, async () => {
    await withFairQueueFixture(kind.replaceAll("/", "-"), async t => {
      const { a, b, c, d, e, people } = await t.base(kind === "merge/fair");
      let proposalId: string | null = null;
      if (kind === "merge/fair") {
        const proposal = await t.merge.createParticipantMergeProposal({ ...t.scope, sourceId: people[2].id, targetId: people[0].id });
        await t.merge.consentParticipantMerge(t.fixture.tokenA, people[2].credential, proposal.id, true);
        await t.merge.consentParticipantMerge(t.fixture.tokenA, people[0].credential, proposal.id, true);
        proposalId = proposal.id;
      }
      const preview = await t.fair.previewFairEventQueue(t.scope);
      const sort = () => t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision });
      const operations: (() => Promise<unknown>)[] = kind === "approve/approve" ? [() => t.action(d, "approve"), () => t.action(e, "approve")] :
        kind === "approve/move" ? [() => t.action(d, "approve"), () => t.move(a, 1)] :
        kind === "approve/start" ? [() => t.action(d, "approve"), () => t.action(a, "start")] :
        kind === "fair/move" ? [sort, () => t.move(b, 1)] :
        kind === "fair/approve" ? [sort, () => t.action(d, "approve")] :
        kind === "fair/start" ? [sort, () => t.action(a, "start")] :
        kind === "fair/restore" ? [sort, () => t.action(c, "restore")] :
        kind === "merge/fair" ? [sort, () => t.merge.completeParticipantMerge({ ...t.scope, proposalId: proposalId!, action: "complete" })] :
        kind === "done/fair" ? [sort, () => t.action(a, "done")] : [sort, sort];
      let outcomes: PromiseSettledResult<unknown>[] = [];
      await blockedSlice4Race(t.sql, tx => tx`select id from public.event_sessions where id=${t.fixture.sessionA} for no key update`.then(() => {}), operations, "event_sessions", results => {
        outcomes = results;
        assert.ok(results.some(result => result.status === "fulfilled"));
        for (const result of results) if (result.status === "rejected") {
          assert.equal(getPublicStatus(result.reason), 409);
          assert.equal(result.reason.code, "FAIR_QUEUE_PREVIEW_STALE");
        }
        if (!kind.includes("fair")) assert.ok(results.every(result => result.status === "fulfilled"));
        if (kind !== "fair/fair") assert.equal(results[1].status, "fulfilled");
      });
      const sorted = outcomes[0].status === "fulfilled", actual = await t.ids();
      if (kind === "approve/approve") {
        assert.ok(JSON.stringify(actual) === JSON.stringify([c, b, a, d, e]) || JSON.stringify(actual) === JSON.stringify([c, b, a, e, d]));
      } else if (kind === "approve/move") assert.deepEqual(actual, [a, c, b, d]);
      else if (kind === "approve/start") assert.deepEqual(actual, [c, b, d]);
      else if (kind === "fair/move") assert.deepEqual(actual, sorted ? [b, a, c] : [b, c, a]);
      else if (kind === "fair/approve") assert.deepEqual(actual, sorted ? [a, b, c, d] : [c, b, a, d]);
      else if (kind === "fair/start" || kind === "done/fair") assert.deepEqual(actual, sorted ? [b, c] : [c, b]);
      else if (kind === "fair/restore") assert.deepEqual(actual, sorted ? [a, b] : [b, a]);
      else if (kind === "merge/fair") {
        assert.deepEqual(actual, sorted ? [a, b, c] : [c, b, a]);
        assert.equal((await t.sql`select event_participant_id::integer from public.song_requests where id=${c}`)[0].event_participant_id, people[0].id);
      } else {
        assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
        assert.deepEqual(actual, [a, b, c]);
        assert.equal((await t.sql`select count(*)::integer as count from public.operator_audit_log where action='event_queue_fair_sort'`)[0].count, 1);
      }
      const rows = await t.sql`select id::integer,position::integer,status from public.song_requests where event_id=${t.fixture.eventA} and status='approved' order by position,id`;
      assert.deepEqual(rows.map(row => row.position), rows.map((_, index) => index + 1), "No duplicate positions or gaps after a real race");
      assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
      assert.equal((await t.sql`select count(*)::integer as count from public.song_requests where event_id=${t.fixture.eventA}`)[0].count, 5, "No requests disappear");
      if (kind === "approve/start" || kind === "fair/start") assert.equal((await t.sql`select status,position from public.song_requests where id=${a}`)[0].status, "now");
    });
  });
}


async function placementTools(t: Awaited<ReturnType<typeof fairQueueTools>>) {
  const revision = async () => queuePlacementRevision((await t.queue.getDashboardOrganizationEventQueueForAuthUser(t.scope))!.items);
  const place = async (id: number, position: number, expectedRevision: string, lane: "approved" | "pending" | "rejected" = "approved", confirmed?: boolean) =>
    t.queue.placeDashboardEventQueueRequestForAuthUser({ ...t.scope, requestId: id, placement: { lane, position, expectedRevision, confirmed } });
  return { revision, place };
}

test("postgres:17-alpine: DnD atomic placement, canonical order, approval history and invalid transition", async () => {
  await withFairQueueFixture("placement", async t => {
    const { a, b, c, d } = await t.base(); const p = await placementTools(t);
    const result = await p.place(d, 2, await p.revision());
    assert.deepEqual(await t.ids(), [c, d, b, a]);
    assert.deepEqual(result.items.filter(row => row.status === "approved").map(row => row.id), [c, d, b, a]);
    await p.place(a, 1, await p.revision()); assert.deepEqual(await t.ids(), [a, c, d, b]);
    assert.equal((await t.sql`select count(*)::integer as count from public.operator_audit_log
      where action='event_queue_approve' and entity_id=${String(a)}`)[0].count, 1,
    "Manual reorder must not reset the approval timestamp or waiting history");
    const before = await t.snapshot();
    await assert.rejects(p.place(c, 1, await p.revision(), "rejected"), hasPublicError(409, "INVALID_STATUS_TRANSITION"));
    assert.deepEqual(await t.snapshot(), before);
    await p.place(c, 1, await p.revision(), "rejected", true);
    await p.place(c, 1, await p.revision(), "pending");
    await p.place(c, 4, await p.revision()); assert.deepEqual(await t.ids(), [a, d, b, c]);
    await t.action(a, "start");
    await assert.rejects(p.place(a, 1, await p.revision()), hasPublicError(409, "INVALID_STATUS_TRANSITION"));
    const [audit] = await t.sql`select payload from public.operator_audit_log where action='event_queue_manual_drop' order by id desc limit 1`;
    assert.equal(audit.payload.manualDrop, true); assert.equal(audit.payload.targetPosition, 1);
    assert.equal((await t.sql`select status from public.song_requests where id=${a}`)[0].status, "now");
  });
});

test("postgres:17-alpine: DnD stale, RBAC, workspace/event scope, 2/2 and complete rollback", async () => {
  await withFairQueueFixture("placement-denials", async t => {
    const { a, b, d, people } = await t.base(); const p = await placementTools(t);
    const stale = await p.revision(); await t.move(a, 1);
    await assert.rejects(p.place(b, 1, stale), hasPublicError(409, "QUEUE_PLACEMENT_STALE"));
    const before = await t.snapshot();
    await assert.rejects(t.queue.placeDashboardEventQueueRequestForAuthUser({ ...t.scope, eventId: t.fixture.eventPublicIdB, requestId: d, placement: { lane: "approved", position: 1, expectedRevision: await p.revision() } }), hasPublicError(409, "QUEUE_PLACEMENT_STALE"));
    await t.sql`update public.workspace_members set role='viewer' where workspace_id=(select id from public.workspaces where public_id=${t.scope.organizationId})`;
    await assert.rejects(p.place(d, 1, await p.revision()), hasPublicError(403, "WORKSPACE_EVENT_QUEUE_MANAGE_FORBIDDEN"));
    await t.sql`update public.workspace_members set role='owner' where workspace_id=(select id from public.workspaces where public_id=${t.scope.organizationId})`;
    await assert.rejects(p.place(d, 999, await p.revision()), hasPublicError(409, "QUEUE_PLACEMENT_STALE"));
    assert.deepEqual(await t.snapshot(), before, "Out-of-range position rolls back status and versions");
    await t.sql.unsafe(`create function test_fail_drop_audit() returns trigger language plpgsql as $$ begin if NEW.payload @> '{"manualDrop":true}'::jsonb then raise exception 'placement audit failure'; end if; return NEW; end $$`);
    await t.sql.unsafe(`create trigger test_fail_drop_audit before insert on public.operator_audit_log for each row execute function test_fail_drop_audit()`);
    await assert.rejects(p.place(d, 1, await p.revision()));
    assert.deepEqual(await t.snapshot(), before, "All row versions and positions roll back with audit");
    await t.sql.unsafe(`drop trigger test_fail_drop_audit on public.operator_audit_log`);
    await t.sql.unsafe(`drop function test_fail_drop_audit()`);
    const third = await t.request(people[0], t.fixture.secondSongId);
    await p.place(third, 1, await p.revision(), "rejected", true);
    await t.request(people[0], t.fixture.secondSongId);
    await assert.rejects(p.place(third, 1, await p.revision()), hasPublicError(409, "QUEUE_ACTIVE_DUPLICATE"));
    // Distinct song avoids duplicate denial so capacity is checked independently.
    await t.sql`update public.song_requests set song_id=${t.fixture.songId} where id=${third}`;
    await t.sql`update public.song_requests set song_id=${t.fixture.secondSongId} where id=${a}`;
    await assert.rejects(p.place(third, 1, await p.revision()), hasPublicError(409, "SESSION_REQUEST_LIMIT_REACHED"));
    await t.sql`update public.events set status='closed',closed_at=clock_timestamp(),close_reason='manual' where id=${t.fixture.eventA}`;
    await assert.rejects(p.place(d, 1, await p.revision()), hasPublicError(409, "EVENT_QUEUE_CLOSED"));
  });
});

for (const kind of ["drop/drop", "drop/approve", "drop/move", "drop/start", "drop/fair"] as const) {
  test(`postgres:17-alpine: DnD real mutex race ${kind}`, async () => {
    await withFairQueueFixture(kind.replaceAll("/", "-"), async t => {
      const { a, b, d } = await t.base(); const p = await placementTools(t);
      const revision = await p.revision(); const preview = await t.fair.previewFairEventQueue(t.scope);
      const other = kind === "drop/drop" ? () => p.place(b, 1, revision) : kind === "drop/approve" ? () => t.action(d, "approve") :
        kind === "drop/move" ? () => t.move(b, 1) : kind === "drop/start" ? () => t.action(a, "start") :
        () => t.fair.applyFairEventQueue({ ...t.scope, revision: preview.revision });
      await blockedSlice4Race(t.sql, tx => tx`select id from public.event_sessions where id=${t.fixture.sessionA} for no key update`.then(() => {}),
        [() => p.place(a, 1, revision), other], "event_sessions", outcomes => {
          assert.ok(outcomes.some(row => row.status === "fulfilled"));
          if (kind === "drop/drop" || kind === "drop/fair") assert.equal(outcomes.filter(row => row.status === "fulfilled").length, 1);
          for (const row of outcomes) if (row.status === "rejected") {
            assert.equal(getPublicStatus(row.reason), 409);
            assert.ok(["QUEUE_PLACEMENT_STALE", "FAIR_QUEUE_PREVIEW_STALE"].includes(row.reason.code));
          }
        });
      const all = await t.sql`select id,status,position from public.song_requests where event_id=${t.fixture.eventA}`;
      assert.equal(all.length, 5); assert.equal(new Set(all.map(row => row.id)).size, 5);
      const approved = all.filter(row => row.status === "approved").sort((a,b) => a.position-b.position);
      assert.deepEqual(approved.map(row => row.position), approved.map((_,i) => i+1));
      if (kind === "drop/start") assert.equal(all.find(row => Number(row.id) === a)!.status, "now");
    });
  });
}
