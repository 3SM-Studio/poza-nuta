import assert from "node:assert/strict";
import { createHash } from "node:crypto";

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
      await applyPostgresMigrations(sql, 23);
      const fixture = await seedFixture(sql);

      await withApplicationDatabase(harness, async () => {
        const service = await import("../../src/server/session-api/service.ts");

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
          event_participant_id: number | null;
          display_name: string;
          singer_name: string;
          participant_id: number;
        }[]>`
          SELECT
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

        await assert.rejects(
          service.createPublicSessionRequest(
            fixture.tokenA,
            joinedA.credential,
            { songId: fixture.songId },
          ),
          hasPublicError(409, "SESSION_REQUEST_DUPLICATE"),
        );

        await sql`
          INSERT INTO public.song_requests (
            event_id, song_id, singer_name, display_name, position, requested_by
          ) VALUES (
            ${fixture.eventA}, ${fixture.secondSongId}, 'Operator Guest',
            'Operator Guest', 99, 'operator'
          )
        `;
        const [operatorRequest] = await sql<{ event_participant_id: number | null }[]>`
          SELECT event_participant_id::integer
          FROM public.song_requests
          WHERE event_id = ${fixture.eventA} AND requested_by = 'operator'
          ORDER BY id DESC LIMIT 1
        `;
        assert.equal(operatorRequest.event_participant_id, null);

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
          fixture.closedToken,
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
  const [{ POST }, { GET }, { resetSessionRateLimitForTests }] = await Promise.all([
    import("../../src/app/api/s/[token]/join/route.ts"),
    import("../../src/app/api/s/[token]/participant/route.ts"),
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
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Participant test', 'participant-test', 'participanttest00001')
    RETURNING id::integer
  `;
  assert.ok(workspace);

  const now = Date.now();
  const eventInputs = [
    { name: "A", status: "active", starts: now - 3_600_000, ends: now + 3_600_000 },
    { name: "B", status: "active", starts: now - 3_600_000, ends: now + 3_600_000 },
    { name: "Scheduled", status: "draft", starts: now + 3_600_000, ends: now + 7_200_000 },
    { name: "Closed", status: "closed", starts: now - 7_200_000, ends: now - 3_600_000 },
    { name: "Cancelled", status: "cancelled", starts: now - 3_600_000, ends: now + 3_600_000 },
  ] as const;
  const events: Array<{ id: number; sessionId: number; token: string }> = [];

  for (const [index, input] of eventInputs.entries()) {
    const [event] = await sql<{ id: number }[]>`
      INSERT INTO public.events (
        workspace_id, name, session_code, starts_at, ends_at, status,
        song_requests_enabled, public_queue_enabled, closed_at, close_reason
      ) VALUES (
        ${workspace.id}, ${input.name}, ${String(index + 1).padStart(8, "0")},
        ${new Date(input.starts)}, ${new Date(input.ends)}, ${input.status},
        true, true,
        ${input.status === "closed" ? new Date(input.ends) : null},
        ${input.status === "closed" ? "manual" : null}
      ) RETURNING id::integer
    `;
    assert.ok(event);
    const token = String.fromCharCode(65 + index).repeat(22);
    const [session] = await sql<{ id: number }[]>`
      INSERT INTO public.event_sessions (event_id, public_token)
      VALUES (${event.id}, ${token}) RETURNING id::integer
    `;
    assert.ok(session);
    events.push({ id: event.id, sessionId: session.id, token });
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
    eventA: events[0]!.id,
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
