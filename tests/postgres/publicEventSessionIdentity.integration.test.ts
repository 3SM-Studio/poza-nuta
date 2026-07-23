import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

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
const concurrencyDeadlineMs = 5_000;

for (const image of images) {
  test(`${image}: 0021 backfills durable event session identity`, async () => {
    const harness = await startPostgresTestHarness(
      "pozanuta-public-session-identity",
      image,
    );
    const sql = createPostgresTestClient(harness, "postgres", 8);

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 20);
      const fixture = await seedLegacyFixture(sql);
      const before = await fingerprintPreservedData(sql);
      await installAdverseBrowserDefaultPrivileges(sql);

      await applyPostgresMigration(sql, 21);

      const [identity] = await sql<{
        events: number;
        sessions: number;
        codes: number;
        public_ids: number;
        tokens: number;
        invalid_tokens: number;
        invalid_codes: number;
        dual_write_violations: number;
      }[]>`
        SELECT
          (SELECT count(*)::integer FROM public.events) AS events,
          (SELECT count(*)::integer FROM public.event_sessions) AS sessions,
          (SELECT count(*)::integer FROM public.event_session_codes) AS codes,
          (SELECT count(DISTINCT public_id)::integer FROM public.events) AS public_ids,
          (SELECT count(DISTINCT public_token)::integer FROM public.event_sessions) AS tokens,
          (SELECT count(*)::integer FROM public.event_sessions
            WHERE public_token !~ '^[A-Za-z0-9_-]{22}$') AS invalid_tokens,
          (SELECT count(*)::integer FROM public.event_session_codes
            WHERE code !~ '^[0-9]{8}$') AS invalid_codes,
          (SELECT count(*)::integer
            FROM public.events e
            JOIN public.event_sessions s ON s.event_id = e.id
            JOIN public.event_session_codes c
              ON c.session_id = s.id
             AND c.valid_until IS NULL
             AND c.revoked_at IS NULL
            WHERE c.code <> e.session_code) AS dual_write_violations
      `;
      assert.deepEqual(identity, {
        events: fixture.eventCount,
        sessions: fixture.eventCount,
        codes: fixture.eventCount,
        public_ids: fixture.eventCount,
        tokens: fixture.eventCount,
        invalid_tokens: 0,
        invalid_codes: 0,
        dual_write_violations: 0,
      });

      const after = await fingerprintPreservedData(sql);
      assert.deepEqual(after, before);

      const codes = await sql<{ code: string }[]>`
        SELECT code FROM public.event_session_codes ORDER BY code
      `;
      assert.deepEqual(
        codes.map(({ code }) => code),
        [...fixture.sessionCodes].sort(),
      );

      const closeReasons = await sql<{ close_reason: string | null }[]>`
        SELECT close_reason FROM public.events ORDER BY id
      `;
      assert.deepEqual(
        closeReasons.map(({ close_reason }) => close_reason),
        [null, null, "manual", "automatic"],
      );

      await assertCatalogContract(sql);
      await assertConstraintContract(sql);
      await assertRotationContract(sql, fixture.eventIds[0]);
      await assertConcurrentIdentityGeneration(harness, sql, fixture.workspaceId);
      await assertPublicApiDtoContract(harness, fixture);
      await assertConcurrentRotation(harness, fixture);
      await assertLifecycleContract(harness, sql, fixture);
      await assertConcurrentActivePublicEventReopen(harness, sql, fixture);
      await assertWorkspaceScopedIdentityAccess(sql, fixture);
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });

  test(`${image}: 0021 preflight fails before DDL`, async () => {
    const harness = await startPostgresTestHarness(
      "pozanuta-public-session-preflight",
      image,
    );
    const sql = createPostgresTestClient(harness, "postgres");

    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 20);
      await sql`ALTER TABLE public.events ADD COLUMN public_id uuid`;

      await assert.rejects(
        applyPostgresMigration(sql, 21),
        (error: unknown) =>
          isPostgresError(
            error,
            "23514",
            "public_event_session_identity_preflight",
          ),
      );

      const [state] = await sql<{
        sessions: string | null;
        codes: string | null;
        close_reason_columns: number;
        nullable: string;
      }[]>`
        SELECT
          to_regclass('public.event_sessions')::text AS sessions,
          to_regclass('public.event_session_codes')::text AS codes,
          (SELECT count(*)::integer FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'events'
              AND column_name = 'close_reason') AS close_reason_columns,
          (SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'events'
              AND column_name = 'public_id') AS nullable
      `;
      assert.deepEqual(state, {
        sessions: null,
        codes: null,
        close_reason_columns: 0,
        nullable: "YES",
      });
    } finally {
      await sql.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });
}

async function seedLegacyFixture(sql: postgres.Sql) {
  const authUserId = randomUUID();
  await sql`INSERT INTO auth.users (id) VALUES (${authUserId})`;
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Session identity test', 'session-identity-test', 'sessionidentitytest0')
    RETURNING id::integer
  `;
  const [operator] = await sql<{ id: number }[]>`
    INSERT INTO public.operator_users (
      name, display_name, profile_completed_at, auth_user_id, password_hash
    ) VALUES ('session_identity_operator', 'Session Identity', now(), ${authUserId}, 'test-only')
    RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.workspace_members (workspace_id, operator_user_id, role)
    VALUES (${workspace.id}, ${operator.id}, 'owner')
  `;

  const events = await sql<{ id: number; session_code: string }[]>`
    INSERT INTO public.events (
      workspace_id, name, status, starts_at, auto_close_at, ends_at, closed_at
    ) VALUES
      (${workspace.id}, 'Draft', 'draft', now() + interval '1 hour', now() + interval '3 hours', now() + interval '3 hours', null),
      (${workspace.id}, 'Active', 'active', now() - interval '1 hour', now() + interval '2 hours', now() + interval '2 hours', null),
      (${workspace.id}, 'Manual closed', 'closed', now() - interval '3 hours', now() + interval '1 hour', now() + interval '1 hour', now() - interval '20 minutes'),
      (${workspace.id}, 'Automatic closed', 'closed', now() - interval '4 hours', now() - interval '1 hour', now() - interval '1 hour', now() - interval '30 minutes')
    RETURNING id::integer, session_code
  `;

  await sql`
    INSERT INTO public.event_access_links (event_id, code_hash, label, active, revoked_at)
    VALUES
      (${events[0].id}, 'historical-one', 'one', false, now()),
      (${events[1].id}, 'historical-two', 'two', false, now())
  `;
  const [song] = await sql<{ id: number }[]>`
    INSERT INTO public.songs (
      source, source_song_id, title, artist, normalized_title,
      normalized_artist, search_text
    ) VALUES (
      'ising', 'identity-test-song', 'Identity Test', 'Poza Nuta',
      'identity test', 'poza nuta', 'identity test poza nuta'
    ) RETURNING id::integer
  `;
  await sql`
    INSERT INTO public.song_requests (
      event_id, song_id, singer_name, display_name, status, position, requested_by
    ) VALUES
      (${events[1].id}, ${song.id}, 'Guest One', 'Guest One', 'approved', 1, 'public'),
      (${events[2].id}, ${song.id}, 'Guest Two', 'Guest Two', 'done', 0, 'public')
  `;

  return {
    authUserId,
    eventCount: events.length,
    eventIds: events.map(({ id }) => id),
    sessionCodes: events.map(({ session_code }) => session_code),
    workspaceId: workspace.id,
    workspacePublicId: "sessionidentitytest0",
    operatorId: operator.id,
    songId: song.id,
  };
}

async function installAdverseBrowserDefaultPrivileges(sql: postgres.Sql) {
  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL PRIVILEGES ON TABLES TO PUBLIC, anon, authenticated
  `;
  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL PRIVILEGES ON SEQUENCES TO PUBLIC, anon, authenticated
  `;
}

async function fingerprintPreservedData(sql: postgres.Sql) {
  const [row] = await sql<{
    links: number;
    requests: number;
    request_state: string;
    event_codes: string;
  }[]>`
    SELECT
      (SELECT count(*)::integer FROM public.event_access_links) AS links,
      (SELECT count(*)::integer FROM public.song_requests) AS requests,
      (SELECT md5(string_agg(id::text || ':' || status::text || ':' || position::text, ',' ORDER BY id))
        FROM public.song_requests) AS request_state,
      (SELECT md5(string_agg(id::text || ':' || session_code, ',' ORDER BY id))
        FROM public.events) AS event_codes
  `;
  return row;
}

async function assertCatalogContract(sql: postgres.Sql) {
  const expectedIndexes = [
    "event_session_codes_code_idx",
    "event_session_codes_current_session_idx",
    "event_session_codes_release_after_idx",
    "event_session_codes_session_created_at_idx",
    "event_sessions_event_id_idx",
    "event_sessions_public_token_idx",
    "events_public_id_idx",
  ];
  const indexes = await sql<{ name: string; valid: boolean; ready: boolean }[]>`
    SELECT c.relname AS name, i.indisvalid AS valid, i.indisready AS ready
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ANY(${expectedIndexes})
    ORDER BY c.relname
  `;
  assert.deepEqual(
    [...indexes],
    [...expectedIndexes].sort().map((name) => ({ name, valid: true, ready: true })),
  );

  const [security] = await sql<{
    session_rls: boolean;
    code_rls: boolean;
    policies: number;
    anon_privileges: boolean;
    authenticated_privileges: boolean;
    browser_sequence_privileges: boolean;
    public_privileges: boolean;
  }[]>`
    SELECT
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_sessions'::regclass) AS session_rls,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_session_codes'::regclass) AS code_rls,
      (SELECT count(*)::integer FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('event_sessions', 'event_session_codes')) AS policies,
      has_table_privilege('anon', 'public.event_sessions', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('anon', 'public.event_session_codes', 'SELECT,INSERT,UPDATE,DELETE') AS anon_privileges,
      has_table_privilege('authenticated', 'public.event_sessions', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated', 'public.event_session_codes', 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_privileges
      ,
      has_sequence_privilege('anon', 'public.event_sessions_id_seq', 'USAGE,SELECT,UPDATE')
        OR has_sequence_privilege('anon', 'public.event_session_codes_id_seq', 'USAGE,SELECT,UPDATE')
        OR has_sequence_privilege('authenticated', 'public.event_sessions_id_seq', 'USAGE,SELECT,UPDATE')
        OR has_sequence_privilege('authenticated', 'public.event_session_codes_id_seq', 'USAGE,SELECT,UPDATE')
        AS browser_sequence_privileges,
      EXISTS (
        SELECT 1
        FROM pg_class c
        CROSS JOIN LATERAL aclexplode(
          coalesce(
            c.relacl,
            acldefault(
              CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
              c.relowner
            )
          )
        ) privilege
        WHERE c.oid IN (
          'public.event_sessions'::regclass,
          'public.event_session_codes'::regclass,
          'public.event_sessions_id_seq'::regclass,
          'public.event_session_codes_id_seq'::regclass
        )
          AND privilege.grantee = 0
      ) AS public_privileges
  `;
  assert.deepEqual(security, {
    session_rls: true,
    code_rls: true,
    policies: 0,
    anon_privileges: false,
    authenticated_privileges: false,
    browser_sequence_privileges: false,
    public_privileges: false,
  });

  const [realtimePolicy] = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'public clients can receive public queue broadcasts'
      AND qual LIKE '%public:session:%'
  `;
  assert.equal(realtimePolicy.count, 1);
}

async function assertConstraintContract(sql: postgres.Sql) {
  const [session] = await sql<{ id: number }[]>`
    SELECT id::integer FROM public.event_sessions ORDER BY id DESC LIMIT 1
  `;

  await assert.rejects(
    sql`
      INSERT INTO public.event_sessions (event_id, public_token)
      VALUES ((SELECT event_id FROM public.event_sessions ORDER BY id LIMIT 1), 'not-a-valid-token')
    `,
    (error: unknown) =>
      isPostgresError(error, "23514", "event_sessions_public_token_format_check"),
  );

  await assert.rejects(
    sql`
      INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
      VALUES (${session.id}, '12345678', 'operator_rotation')
    `,
    (error: unknown) =>
      isPostgresError(error, "23505", "event_session_codes_code_idx") ||
      isPostgresError(error, "23505", "event_session_codes_current_session_idx"),
  );

  await assert.rejects(
    sql`
      UPDATE public.events
      SET close_reason = 'unsafe'
      WHERE id = (SELECT id FROM public.events WHERE closed_at IS NOT NULL LIMIT 1)
    `,
    (error: unknown) =>
      isPostgresError(error, "23514", "events_close_reason_check"),
  );

  const validFrom = new Date("2026-07-18T10:00:00.000Z");
  const revokedAt = new Date("2026-07-18T11:00:00.000Z");
  const releaseAfter = new Date("2027-07-18T11:00:00.000Z");

  await assertRejectedSessionCodeAssignment(
    sql,
    session.id,
    {
      validFrom,
      revokedAt: new Date(validFrom.getTime() - 1),
      validUntil: new Date(validFrom.getTime() - 1),
      releaseAfter,
    },
    "event_session_codes_chronology_check",
  );
  await assertRejectedSessionCodeAssignment(
    sql,
    session.id,
    {
      validFrom,
      revokedAt,
      validUntil: new Date(revokedAt.getTime() + 1),
      releaseAfter,
    },
    "event_session_codes_chronology_check",
  );
  await assertRejectedSessionCodeAssignment(
    sql,
    session.id,
    {
      validFrom,
      revokedAt,
      validUntil: revokedAt,
      releaseAfter: new Date(
        revokedAt.getTime() + 365 * 24 * 60 * 60 * 1_000 - 1,
      ),
    },
    "event_session_codes_revocation_check",
  );
  await assertRejectedSessionCodeAssignment(
    sql,
    session.id,
    {
      validFrom,
      revokedAt,
      validUntil: null,
      releaseAfter,
    },
    "event_session_codes_revocation_check",
  );

  const [historicalOperator] = await sql<{ id: number }[]>`
    INSERT INTO public.operator_users (
      name, display_name, profile_completed_at, password_hash
    ) VALUES (
      'revocation_history_operator', 'Revocation History', now(), 'test-only'
    )
    RETURNING id::integer
  `;
  assert.ok(historicalOperator);
  const historicalCode = randomEightDigitCode();
  const [historicalAssignment] = await sql<{ id: number }[]>`
    INSERT INTO public.event_session_codes (
      session_id, code, valid_from, valid_until, revoked_at, release_after,
      revoked_by_operator_id, rotation_reason
    ) VALUES (
      ${session.id}, ${historicalCode}, ${validFrom}, ${revokedAt}, ${revokedAt},
      ${releaseAfter}, ${historicalOperator.id}, 'operator_rotation'
    )
    RETURNING id::integer
  `;
  assert.ok(historicalAssignment);
  await sql`
    DELETE FROM public.operator_users WHERE id = ${historicalOperator.id}
  `;
  const [preservedAssignment] = await sql<{
    count: number;
    operator_cleared: boolean;
  }[]>`
    SELECT
      count(*)::integer AS count,
      bool_and(revoked_by_operator_id IS NULL) AS operator_cleared
    FROM public.event_session_codes
    WHERE id = ${historicalAssignment.id}
  `;
  assert.deepEqual(preservedAssignment, {
    count: 1,
    operator_cleared: true,
  });
}

async function assertRejectedSessionCodeAssignment(
  sql: postgres.Sql,
  sessionId: number,
  input: {
    validFrom: Date;
    revokedAt: Date | null;
    validUntil: Date | null;
    releaseAfter: Date | null;
  },
  constraint: string,
) {
  await assert.rejects(
    sql`
      INSERT INTO public.event_session_codes (
        session_id, code, valid_from, valid_until, revoked_at, release_after,
        rotation_reason
      ) VALUES (
        ${sessionId}, ${randomEightDigitCode()}, ${input.validFrom},
        ${input.validUntil}, ${input.revokedAt}, ${input.releaseAfter},
        'operator_rotation'
      )
    `,
    (error: unknown) => isPostgresError(error, "23514", constraint),
  );
}

async function assertRotationContract(sql: postgres.Sql, eventId: number) {
  const before = await getIdentityState(sql, eventId);
  const firstCode = randomEightDigitCode();
  const secondCode = randomEightDigitCode(firstCode);

  await rotateCode(sql, eventId, firstCode);
  const afterFirst = await getIdentityState(sql, eventId);
  assert.equal(afterFirst.public_token, before.public_token);
  assert.equal(afterFirst.code, firstCode);
  assert.equal(afterFirst.current_codes, 1);

  await rotateCode(sql, eventId, secondCode);
  const afterSecond = await getIdentityState(sql, eventId);
  assert.equal(afterSecond.public_token, before.public_token);
  assert.equal(afterSecond.code, secondCode);
  assert.equal(afterSecond.current_codes, 1);
  assert.equal(afterSecond.history_codes, before.history_codes + 2);

  const [oldCodes] = await sql<{ revoked: number; quarantined: number }[]>`
    SELECT
      count(*) FILTER (WHERE revoked_at IS NOT NULL)::integer AS revoked,
      count(*) FILTER (
        WHERE release_after >= revoked_at + interval '365 days'
      )::integer AS quarantined
    FROM public.event_session_codes c
    JOIN public.event_sessions s ON s.id = c.session_id
    WHERE s.event_id = ${eventId}
  `;
  assert.equal(oldCodes.revoked, 2);
  assert.equal(oldCodes.quarantined, 2);
}

async function rotateCode(sql: postgres.Sql, eventId: number, code: string) {
  await sql.begin(async (transaction) => {
    const [current] = await transaction<{
      session_id: number;
      code_id: number;
    }[]>`
      SELECT s.id::integer AS session_id, c.id::integer AS code_id
      FROM public.events e
      JOIN public.event_sessions s ON s.event_id = e.id
      JOIN public.event_session_codes c
        ON c.session_id = s.id
       AND c.valid_until IS NULL
       AND c.revoked_at IS NULL
      WHERE e.id = ${eventId}
      FOR UPDATE OF e, s, c
    `;
    assert.ok(current);
    await transaction`
      UPDATE public.event_session_codes
      SET valid_until = now(), revoked_at = now(), release_after = now() + interval '365 days'
      WHERE id = ${current.code_id}
    `;
    await transaction`
      INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
      VALUES (${current.session_id}, ${code}, 'operator_rotation')
    `;
    await transaction`
      UPDATE public.events SET session_code = ${code}, updated_at = now()
      WHERE id = ${eventId}
    `;
  });
}

async function getIdentityState(sql: postgres.Sql, eventId: number) {
  const [state] = await sql<{
    public_token: string;
    code: string;
    current_codes: number;
    history_codes: number;
  }[]>`
    SELECT
      s.public_token,
      e.session_code AS code,
      count(*) FILTER (
        WHERE c.valid_until IS NULL AND c.revoked_at IS NULL
      )::integer AS current_codes,
      count(*)::integer AS history_codes
    FROM public.events e
    JOIN public.event_sessions s ON s.event_id = e.id
    JOIN public.event_session_codes c ON c.session_id = s.id
    WHERE e.id = ${eventId}
    GROUP BY s.public_token, e.session_code
  `;
  return state;
}

type Harness = Awaited<ReturnType<typeof startPostgresTestHarness>>;
type SqlExecutor = postgres.Sql | postgres.TransactionSql;
type ApplicationDatabase = {
  $client: { end(options: { timeout: number }): Promise<void> };
};

async function assertConcurrentIdentityGeneration(
  harness: Harness,
  sql: postgres.Sql,
  workspaceId: number,
) {
  const left = createPostgresTestClient(harness, "postgres", 1);
  const right = createPostgresTestClient(harness, "postgres", 1);

  try {
    const created = await Promise.all([
      createEventWithGeneratedIdentity(left, workspaceId, "Concurrent identity A"),
      createEventWithGeneratedIdentity(right, workspaceId, "Concurrent identity B"),
    ]);

    assert.equal(new Set(created.map(({ publicId }) => publicId)).size, 2);
    assert.equal(new Set(created.map(({ publicToken }) => publicToken)).size, 2);
    assert.equal(new Set(created.map(({ code }) => code)).size, 2);
    for (const identity of created) {
      assert.match(identity.publicId, /^[0-9a-f-]{36}$/);
      assert.match(identity.publicToken, /^[A-Za-z0-9_-]{22}$/);
      assert.equal(Buffer.from(identity.publicToken, "base64url").length, 16);
      assert.match(identity.code, /^[0-9]{8}$/);
    }

    const [state] = await sql<{
      events: number;
      sessions: number;
      codes: number;
      dual_write_violations: number;
    }[]>`
      SELECT
        count(DISTINCT e.id)::integer AS events,
        count(DISTINCT s.id)::integer AS sessions,
        count(DISTINCT c.id)::integer AS codes,
        count(*) FILTER (WHERE e.session_code <> c.code)::integer AS dual_write_violations
      FROM public.events e
      JOIN public.event_sessions s ON s.event_id = e.id
      JOIN public.event_session_codes c
        ON c.session_id = s.id
       AND c.valid_until IS NULL
       AND c.revoked_at IS NULL
      WHERE e.id = ANY(${created.map(({ eventId }) => eventId)})
    `;
    assert.deepEqual(state, {
      events: 2,
      sessions: 2,
      codes: 2,
      dual_write_violations: 0,
    });
  } finally {
    await Promise.all([
      left.end({ timeout: 5 }),
      right.end({ timeout: 5 }),
    ]);
  }
}

async function createEventWithGeneratedIdentity(
  sql: postgres.Sql,
  workspaceId: number,
  name: string,
) {
  return sql.begin(async (transaction) => {
    const [event] = await transaction<{
      id: number;
      public_id: string;
      session_code: string;
    }[]>`
      INSERT INTO public.events (
        workspace_id, name, status, starts_at, auto_close_at, ends_at
      ) VALUES (
        ${workspaceId}, ${name}, 'draft', now() + interval '1 hour',
        now() + interval '3 hours', now() + interval '3 hours'
      )
      RETURNING id::integer, public_id::text, session_code
    `;
    assert.ok(event);

    const [session] = await transaction<{ id: number; public_token: string }[]>`
      INSERT INTO public.event_sessions (event_id, public_token)
      VALUES (
        ${event.id},
        rtrim(translate(encode(gen_random_bytes(16), 'base64'), '+/', '-_'), '=')
      )
      RETURNING id::integer, public_token
    `;
    assert.ok(session);
    await transaction`
      INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
      VALUES (${session.id}, ${event.session_code}, 'initial')
    `;

    return {
      eventId: event.id,
      publicId: event.public_id,
      publicToken: session.public_token,
      code: event.session_code,
    };
  });
}

async function assertPublicApiDtoContract(
  harness: Harness,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
) {
  const stateClient = createPostgresTestClient(harness, "postgres", 1);
  const activeEventId = fixture.eventIds[1];
  await stateClient`
    UPDATE public.events
    SET song_requests_enabled = true
    WHERE id = ${activeEventId}
  `;
  const identity = await getIdentityState(stateClient, activeEventId);
  await stateClient.end({ timeout: 5 });

  await withApplicationDatabase(harness, async () => {
    const [{ GET }, { POST }, { resetSessionRateLimitForTests }] =
      await Promise.all([
        import("../../src/app/api/s/[token]/event/route.ts"),
        import("../../src/app/api/s/[token]/requests/route.ts"),
        import("../../src/server/session-api/rate-limit-core.ts"),
      ]);
    resetSessionRateLimitForTests();

    const eventResponse = await GET(
      new Request(`http://localhost/api/s/${identity.public_token}/event`, {
        headers: { "x-forwarded-for": "192.0.2.21" },
      }),
      { params: Promise.resolve({ token: identity.public_token }) },
    );
    assert.equal(eventResponse.status, 200);
    const eventBody = (await eventResponse.json()) as unknown;
    assertNoForbiddenPublicFields(eventBody);
    assert.deepEqual(
      Object.keys((eventBody as { event: Record<string, unknown> }).event).sort(),
      [
        "autoCloseAt",
        "closeReason",
        "closedAt",
        "endsAt",
        "name",
        "publicQueueEnabled",
        "publicShowSongTitles",
        "songRequestsEnabled",
        "startsAt",
        "status",
        "venue",
      ].sort(),
    );

    const requestResponse = await POST(
      new Request(`http://localhost/api/s/${identity.public_token}/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.22",
        },
        body: JSON.stringify({
          songId: fixture.songId,
          requesterName: "Public DTO Guest",
        }),
      }),
      { params: Promise.resolve({ token: identity.public_token }) },
    );
    assert.equal(requestResponse.status, 201);
    const requestBody = (await requestResponse.json()) as unknown;
    assert.deepEqual(requestBody, { request: { status: "pending" } });
    assertNoForbiddenPublicFields(requestBody);
  });
}

function assertNoForbiddenPublicFields(value: unknown) {
  const forbidden = new Set([
    "id",
    "eventId",
    "operatorId",
    "publicToken",
    "operator",
    "operatorUser",
  ]);

  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenPublicFields(item);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, nested] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `Forbidden public field: ${key}`);
    assertNoForbiddenPublicFields(nested);
  }
}

async function assertConcurrentRotation(
  harness: Harness,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
) {
  const eventId = fixture.eventIds[0];
  const beforeClient = createPostgresTestClient(harness, "postgres", 1);
  const before = await getIdentityState(beforeClient, eventId);
  await beforeClient.end({ timeout: 5 });
  const blocker = createPostgresTestClient(harness, "postgres", 1);
  const observer = createPostgresTestClient(harness, "postgres", 1);
  const blockerLocked = deferred<number>();
  const releaseBlocker = deferred<void>();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let first: Promise<unknown> | undefined;
  let second: Promise<unknown> | undefined;

  process.env.DATABASE_URL = postgresTestUrl(harness);
  clearApplicationDatabase();

  const heldLock = blocker
    .begin(async (transaction) => {
      const [backend] = await transaction<{ pid: number }[]>`
        SELECT pg_backend_pid()::integer AS pid
      `;
      assert.ok(backend);
      const locked = await lockEventRow(transaction, eventId);
      assert.equal(locked.length, 1);
      blockerLocked.resolve(backend.pid);
      await releaseBlocker.promise;
    })
    .catch((error) => {
      blockerLocked.reject(error);
      throw error;
    });
  void heldLock.catch(() => undefined);

  try {
    await withDeadline(
      blockerLocked.promise,
      "Rotation blocker did not acquire the event row lock.",
    );
    const { rotateDashboardOrganizationEventSessionCodeForAuthUser } =
      await import("../../src/server/operator-api/organizations.ts");
    const input = {
      authUserId: fixture.authUserId,
      organizationId: fixture.workspacePublicId,
      eventId,
      expectedSessionCode: before.code,
    };
    first = rotateDashboardOrganizationEventSessionCodeForAuthUser(input);
    second = rotateDashboardOrganizationEventSessionCodeForAuthUser(input);
    void first.catch(() => undefined);
    void second.catch(() => undefined);

    await waitForBlockedApplicationSessions(
      observer,
      "postgres",
      "public-session-rotation-test",
      2,
    );
    releaseBlocker.resolve();
    const results = await Promise.allSettled([first, second]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal(getErrorCode(rejected.reason), "EVENT_SESSION_CODE_STALE");
    assert.equal(getErrorStatus(rejected.reason), 409);

    const applicationDatabase = getApplicationDatabase();
    assert.ok(applicationDatabase);
    await applicationDatabase.$client.end({ timeout: 5 });
    clearApplicationDatabase();

    const afterClient = createPostgresTestClient(harness, "postgres", 1);
    const after = await getIdentityState(afterClient, eventId);
    try {
      assert.equal(after.public_token, before.public_token);
      assert.notEqual(after.code, before.code);
      assert.equal(after.current_codes, 1);
      assert.equal(after.history_codes, before.history_codes + 1);
      const audits = await afterClient<{ payload: Record<string, unknown> }[]>`
        SELECT payload
        FROM public.operator_audit_log
        WHERE event_id = ${eventId}
          AND action = 'event.session_code.rotate'
      `;
      assert.equal(audits.length, 1);
      assert.deepEqual(audits[0]?.payload, {
        schemaVersion: 1,
        targetType: "event",
        outcome: "success",
        operation: "session_code_rotation",
        reason: "operator_requested",
      });
      const serializedAudit = JSON.stringify(audits[0]?.payload);
      assert.equal(serializedAudit.includes(before.code), false);
      assert.equal(serializedAudit.includes(after.code), false);
      assert.equal(serializedAudit.includes(before.public_token), false);
    } finally {
      await afterClient.end({ timeout: 5 });
    }
  } finally {
    releaseBlocker.resolve();
    await Promise.allSettled([
      heldLock,
      ...(first ? [first] : []),
      ...(second ? [second] : []),
    ]);
    const applicationDatabase = getApplicationDatabase();
    if (applicationDatabase) {
      await applicationDatabase.$client.end({ timeout: 5 });
      clearApplicationDatabase();
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    await Promise.all([
      blocker.end({ timeout: 5 }),
      observer.end({ timeout: 5 }),
    ]);
  }
}

async function assertConcurrentActivePublicEventReopen(
  harness: Harness,
  sql: postgres.Sql,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
) {
  const closedAt = new Date(Date.now() - 60_000);
  const eventIds = await Promise.all([
    createLifecycleEvent(sql, fixture.workspaceId, {
      status: "closed",
      closedAt,
      closeReason: "manual",
      autoCloseAt: null,
    }),
    createLifecycleEvent(sql, fixture.workspaceId, {
      status: "closed",
      closedAt,
      closeReason: "manual",
      autoCloseAt: null,
    }),
  ]);
  const barrierKey = 2_100_021;
  await sql`
    CREATE FUNCTION public.block_p3_concurrent_event_activation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.is_active_public_event AND NOT OLD.is_active_public_event THEN
        PERFORM pg_advisory_xact_lock(2100021);
      END IF;
      RETURN NEW;
    END
    $$
  `;
  await sql`
    CREATE TRIGGER block_p3_concurrent_event_activation
    BEFORE UPDATE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.block_p3_concurrent_event_activation()
  `;

  const blocker = createPostgresTestClient(harness, "postgres", 1);
  const observer = createPostgresTestClient(harness, "postgres", 1);
  const blockerReady = deferred<number>();
  const releaseBlocker = deferred<void>();
  const heldLock = blocker
    .begin(async (transaction) => {
      const [backend] = await transaction<{ pid: number }[]>`
        SELECT pg_backend_pid()::integer AS pid
      `;
      assert.ok(backend);
      await transaction`SELECT pg_advisory_xact_lock(${barrierKey})`;
      blockerReady.resolve(backend.pid);
      await releaseBlocker.promise;
    })
    .catch((error) => {
      blockerReady.reject(error);
      throw error;
    });
  void heldLock.catch(() => undefined);

  try {
    await withDeadline(
      blockerReady.promise,
      "Activation barrier did not acquire its advisory lock.",
    );
    const results = await withApplicationDatabase(harness, async () => {
      const { reopenDashboardOrganizationEventForAuthUser } =
        await import("../../src/server/operator-api/organizations.ts");
      const closesAt = new Date(Date.now() + 60 * 60 * 1_000);
      const attempts = eventIds.map((eventId) =>
        reopenDashboardOrganizationEventForAuthUser({
          authUserId: fixture.authUserId,
          organizationId: fixture.workspacePublicId,
          eventId,
          extension: { minutes: null, closesAt },
        }),
      );
      for (const attempt of attempts) void attempt.catch(() => undefined);

      await waitForBlockedApplicationSessions(
        observer,
        "postgres",
        "public-session-rotation-test",
        2,
      );
      releaseBlocker.resolve();
      return Promise.allSettled(attempts);
    });

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal(getErrorStatus(rejected.reason), 409);
    assert.equal(
      getErrorCode(rejected.reason),
      "ACTIVE_PUBLIC_EVENT_ALREADY_EXISTS",
    );

    const [state] = await sql<{ active: number; audits: number }[]>`
      SELECT
        (SELECT count(*)::integer
         FROM public.events
         WHERE id = ANY(${eventIds})
           AND is_active_public_event) AS active,
        (SELECT count(*)::integer
         FROM public.operator_audit_log
         WHERE event_id = ANY(${eventIds})
           AND action = 'event.reopen') AS audits
    `;
    assert.deepEqual(state, { active: 1, audits: 1 });
  } finally {
    releaseBlocker.resolve();
    await Promise.allSettled([heldLock]);
    await sql`
      UPDATE public.events
      SET is_active_public_event = false
      WHERE id = ANY(${eventIds})
    `;
    await sql`DROP TRIGGER IF EXISTS block_p3_concurrent_event_activation ON public.events`;
    await sql`DROP FUNCTION IF EXISTS public.block_p3_concurrent_event_activation()`;
    await Promise.all([
      blocker.end({ timeout: 5 }),
      observer.end({ timeout: 5 }),
    ]);
  }
}

async function lockIdentity(
  transaction: postgres.TransactionSql,
  eventId: number,
) {
  return transaction<{ session_id: number; code_id: number }[]>`
    SELECT s.id::integer AS session_id, c.id::integer AS code_id
    FROM public.events e
    JOIN public.event_sessions s ON s.event_id = e.id
    JOIN public.event_session_codes c
      ON c.session_id = s.id
     AND c.valid_until IS NULL
     AND c.revoked_at IS NULL
    WHERE e.id = ${eventId}
    FOR UPDATE OF e, s, c
  `;
}

async function assertLifecycleContract(
  harness: Harness,
  sql: postgres.Sql,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
) {
  await withApplicationDatabase(harness, async () => {
    const services =
      await import("../../src/server/operator-api/organizations.ts");
    const sessionService =
      await import("../../src/server/session-api/service.ts");
    await assertCloseReopenPreservesQueue(
      harness,
      sql,
      fixture,
      services,
      sessionService,
    );
    await assertConcurrentReopenRechecksState(
      harness,
      sql,
      fixture,
      services,
    );
    await assertConcurrentCloseExtendRechecksState(
      harness,
      sql,
      fixture,
      services,
    );
    await assertConcurrentExtensionsSerialize(
      harness,
      sql,
      fixture,
      services,
    );
  });
  await assertManualAndAutomaticReopenBoundaries(sql, fixture.workspaceId);
}

async function assertCloseReopenPreservesQueue(
  harness: Harness,
  sql: postgres.Sql,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
  services: typeof import("../../src/server/operator-api/organizations.ts"),
  sessionService: typeof import("../../src/server/session-api/service.ts"),
) {
  const eventId = fixture.eventIds[1];
  const reference = new Date();
  const newCloseAt = new Date(reference.getTime() + 2 * 60 * 60 * 1_000);
  await prepareActiveEvent(sql, eventId, reference);
  const before = await requestFingerprint(sql, eventId);

  const results = await runBlockedProductionEventRace(
    harness,
    eventId,
    () =>
      services.closeDashboardOrganizationEventForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.workspacePublicId,
        eventId,
      }),
    () =>
      services.reopenDashboardOrganizationEventForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.workspacePublicId,
        eventId,
        extension: { minutes: null, closesAt: newCloseAt },
      }),
  );
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "fulfilled");

  const [event] = await sql<{
    status: string;
    active: boolean;
    closed_at: Date | null;
    close_reason: string | null;
    auto_close_at: Date;
  }[]>`
    SELECT
      status::text,
      is_active_public_event AS active,
      closed_at,
      close_reason,
      auto_close_at
    FROM public.events
    WHERE id = ${eventId}
  `;
  assert.deepEqual(event, {
    status: "active",
    active: true,
    closed_at: null,
    close_reason: null,
    auto_close_at: newCloseAt,
  });
  assert.deepEqual(await requestFingerprint(sql, eventId), before);

  const [identity] = await sql<{ public_token: string }[]>`
    SELECT public_token
    FROM public.event_sessions
    WHERE event_id = ${eventId}
  `;
  assert.ok(identity);
  await sessionService.createPublicSessionRequest(identity.public_token, {
    songId: fixture.songId,
    singerName: "Guest after reopen",
    note: null,
  });
  const [requestCount] = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM public.song_requests
    WHERE event_id = ${eventId}
  `;
  assert.equal(requestCount.count, before.count + 1);
  await assertLatestEventAudit(sql, eventId, "event.reopen", {
    operation: "reopen",
    reason: "operator_requested",
    previousCloseAt: "string",
    newCloseAt: newCloseAt.toISOString(),
  });
  await sql`
    UPDATE public.events SET is_active_public_event = false WHERE id = ${eventId}
  `;
}

async function assertConcurrentReopenRechecksState(
  harness: Harness,
  sql: postgres.Sql,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
  services: typeof import("../../src/server/operator-api/organizations.ts"),
) {
  const closedAt = new Date(Date.now() - 60_000);
  const eventId = await createLifecycleEvent(sql, fixture.workspaceId, {
    status: "closed",
    closedAt,
    closeReason: "manual",
    autoCloseAt: null,
  });
  const firstCloseAt = new Date(Date.now() + 2 * 60 * 60 * 1_000);
  const secondCloseAt = new Date(Date.now() + 3 * 60 * 60 * 1_000);

  const results = await runBlockedProductionEventRace(
    harness,
    eventId,
    () =>
      services.reopenDashboardOrganizationEventForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.workspacePublicId,
        eventId,
        extension: { minutes: null, closesAt: firstCloseAt },
      }),
    () =>
      services.reopenDashboardOrganizationEventForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.workspacePublicId,
        eventId,
        extension: { minutes: null, closesAt: secondCloseAt },
      }),
  );
  assert.equal(results[0].status, "fulfilled");
  assertRejectedWithCode(results[1], 409, "EVENT_REOPEN_WINDOW_EXPIRED");
  await sql`
    UPDATE public.events SET is_active_public_event = false WHERE id = ${eventId}
  `;
}

async function assertConcurrentCloseExtendRechecksState(
  harness: Harness,
  sql: postgres.Sql,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
  services: typeof import("../../src/server/operator-api/organizations.ts"),
) {
  const eventId = await createLifecycleEvent(sql, fixture.workspaceId, {
    status: "active",
    closedAt: null,
    closeReason: null,
    autoCloseAt: new Date(Date.now() + 2 * 60 * 60 * 1_000),
  });
  const results = await runBlockedProductionEventRace(
    harness,
    eventId,
    () =>
      services.closeDashboardOrganizationEventForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.workspacePublicId,
        eventId,
      }),
    () =>
      services.extendDashboardOrganizationEventForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.workspacePublicId,
        eventId,
        extension: { minutes: 60, closesAt: null },
      }),
  );
  assert.equal(results[0].status, "fulfilled");
  assertRejectedWithCode(results[1], 409, "EVENT_MANAGEMENT_LOCKED");
}

async function assertConcurrentExtensionsSerialize(
  harness: Harness,
  sql: postgres.Sql,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
  services: typeof import("../../src/server/operator-api/organizations.ts"),
) {
  const originalCloseAt = new Date(Date.now() + 2 * 60 * 60 * 1_000);
  const eventId = await createLifecycleEvent(sql, fixture.workspaceId, {
    status: "active",
    closedAt: null,
    closeReason: null,
    autoCloseAt: originalCloseAt,
  });
  const results = await runBlockedProductionEventRace(
    harness,
    eventId,
    () =>
      services.extendDashboardOrganizationEventForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.workspacePublicId,
        eventId,
        extension: { minutes: 60, closesAt: null },
      }),
    () =>
      services.extendDashboardOrganizationEventForAuthUser({
        authUserId: fixture.authUserId,
        organizationId: fixture.workspacePublicId,
        eventId,
        extension: { minutes: 60, closesAt: null },
      }),
  );
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "fulfilled");
  const [event] = await sql<{ auto_close_at: Date; ends_at: Date }[]>`
    SELECT auto_close_at, ends_at FROM public.events WHERE id = ${eventId}
  `;
  const expected = new Date(originalCloseAt.getTime() + 120 * 60 * 1_000);
  assert.deepEqual(event, { auto_close_at: expected, ends_at: expected });
  const audits = await sql<{ payload: Record<string, unknown> }[]>`
    SELECT payload
    FROM public.operator_audit_log
    WHERE event_id = ${eventId}
      AND action = 'event.extend'
    ORDER BY id
  `;
  assert.equal(audits.length, 2);
  for (const audit of audits) {
    assertStandardEventAudit(audit.payload, "extend");
  }
  assert.equal(audits[0]?.payload.previousCloseAt, originalCloseAt.toISOString());
  assert.equal(audits[1]?.payload.newCloseAt, expected.toISOString());
  await sql`
    UPDATE public.events SET is_active_public_event = false WHERE id = ${eventId}
  `;
}

async function assertManualAndAutomaticReopenBoundaries(
  sql: postgres.Sql,
  workspaceId: number,
) {
  const closeInstant = new Date("2026-07-18T12:00:00.000Z");
  const cases = [
    {
      reason: "manual",
      closedAt: closeInstant,
      autoCloseAt: null,
    },
    {
      reason: "automatic",
      closedAt: new Date("2026-07-18T12:02:00.000Z"),
      autoCloseAt: closeInstant,
    },
  ] as const;

  for (const lifecycleCase of cases) {
    const eventId = await createLifecycleEvent(sql, workspaceId, {
      status: "closed",
      closedAt: lifecycleCase.closedAt,
      closeReason: lifecycleCase.reason,
      autoCloseAt: lifecycleCase.autoCloseAt,
    });
    assert.equal(
      await canReopenAt(sql, eventId, new Date("2026-07-18T12:19:59.000Z")),
      true,
    );
    assert.equal(
      await canReopenAt(sql, eventId, new Date("2026-07-18T12:20:00.000Z")),
      false,
    );
    assert.equal(
      await canReopenAt(sql, eventId, new Date("2026-07-18T12:20:01.000Z")),
      false,
    );

    await sql.begin((transaction) =>
      reopenEventInTransaction(
        transaction,
        eventId,
        new Date("2026-07-18T12:19:59.000Z"),
        new Date("2026-07-18T14:00:00.000Z"),
      ),
    );
    await sql`
      UPDATE public.events SET is_active_public_event = false WHERE id = ${eventId}
    `;
  }
}

async function prepareActiveEvent(
  sql: postgres.Sql,
  eventId: number,
  reference: Date,
) {
  await sql`
    UPDATE public.events
    SET
      status = 'active',
      is_active_public_event = true,
      starts_at = ${new Date(reference.getTime() - 60 * 60 * 1_000)},
      auto_close_at = ${new Date(reference.getTime() + 2 * 60 * 60 * 1_000)},
      ends_at = ${new Date(reference.getTime() + 2 * 60 * 60 * 1_000)},
      closed_at = NULL,
      close_reason = NULL
    WHERE id = ${eventId}
  `;
}

async function createLifecycleEvent(
  sql: postgres.Sql,
  workspaceId: number,
  input: {
    status: "active" | "closed";
    closedAt: Date | null;
    closeReason: "manual" | "automatic" | null;
    autoCloseAt: Date | null;
  },
) {
  const startsAt = new Date("2026-07-18T10:00:00.000Z");
  const endsAt = input.autoCloseAt ?? new Date("2026-07-18T14:00:00.000Z");
  return sql.begin(async (transaction) => {
    const [event] = await transaction<{ id: number; session_code: string }[]>`
      INSERT INTO public.events (
        workspace_id, name, status, is_active_public_event,
        starts_at, auto_close_at, ends_at, closed_at, close_reason
      ) VALUES (
        ${workspaceId}, 'Lifecycle concurrency', ${input.status},
        ${input.status === "active"},
        ${startsAt}, ${input.autoCloseAt}, ${endsAt}, ${input.closedAt},
        ${input.closeReason}
      )
      RETURNING id::integer, session_code
    `;
    assert.ok(event);
    const [session] = await transaction<{ id: number }[]>`
      INSERT INTO public.event_sessions (event_id, public_token)
      VALUES (
        ${event.id},
        rtrim(translate(encode(gen_random_bytes(16), 'base64'), '+/', '-_'), '=')
      )
      RETURNING id::integer
    `;
    assert.ok(session);
    await transaction`
      INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
      VALUES (${session.id}, ${event.session_code}, 'initial')
    `;
    return event.id;
  });
}

async function requestFingerprint(sql: postgres.Sql, eventId: number) {
  const [state] = await sql<{ count: number; fingerprint: string | null }[]>`
    SELECT
      count(*)::integer AS count,
      md5(string_agg(
        id::text || ':' || status::text || ':' || position::text || ':' || version::text,
        ',' ORDER BY id
      )) AS fingerprint
    FROM public.song_requests
    WHERE event_id = ${eventId}
  `;
  return state;
}

async function reopenEventInTransaction(
  transaction: postgres.TransactionSql,
  eventId: number,
  now: Date,
  closesAt: Date,
) {
  const [event] = await lockEventRow(transaction, eventId);
  const closeInstant = effectiveCloseInstant(event);
  if (
    event.status !== "closed" ||
    closeInstant === null ||
    now.getTime() >= closeInstant.getTime() + 20 * 60 * 1_000
  ) {
    throw new Error("EVENT_REOPEN_WINDOW_EXPIRED");
  }
  if (closesAt.getTime() <= now.getTime()) {
    throw new Error("EVENT_CLOSE_TIME_INVALID");
  }
  await transaction`
    UPDATE public.events
    SET
      status = 'active',
      is_active_public_event = true,
      auto_close_at = ${closesAt},
      ends_at = ${closesAt},
      closed_at = NULL,
      close_reason = NULL,
      updated_at = ${now}
    WHERE id = ${eventId}
  `;
}

type LockedEvent = {
  status: string;
  auto_close_at: Date | null;
  ends_at: Date;
  closed_at: Date | null;
  close_reason: string | null;
};

async function lockEventRow(
  transaction: postgres.TransactionSql,
  eventId: number,
) {
  return transaction<LockedEvent[]>`
    SELECT status::text, auto_close_at, ends_at, closed_at, close_reason
    FROM public.events
    WHERE id = ${eventId}
    FOR UPDATE
  `;
}

function effectiveCloseInstant(event: LockedEvent) {
  if (event.close_reason === "manual" && event.closed_at) return event.closed_at;
  return event.auto_close_at ?? event.closed_at ?? event.ends_at;
}

async function canReopenAt(sql: postgres.Sql, eventId: number, now: Date) {
  const [result] = await sql<{ allowed: boolean }[]>`
    SELECT
      status = 'closed'
      AND ${now} < (
        CASE
          WHEN close_reason = 'manual' AND closed_at IS NOT NULL THEN closed_at
          ELSE coalesce(auto_close_at, closed_at, ends_at)
        END + interval '20 minutes'
      ) AS allowed
    FROM public.events
    WHERE id = ${eventId}
  `;
  return result.allowed;
}

async function assertWorkspaceScopedIdentityAccess(
  sql: postgres.Sql,
  fixture: Awaited<ReturnType<typeof seedLegacyFixture>>,
) {
  const [otherWorkspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Other workspace', 'other-session-workspace', 'othersessionworkspac')
    RETURNING id::integer
  `;
  assert.ok(otherWorkspace);
  const targetEventId = fixture.eventIds[0];
  const [target] = await sql<{ public_id: string }[]>`
    SELECT public_id::text FROM public.events WHERE id = ${targetEventId}
  `;
  assert.ok(target);

  const byPublicId = await sql<{ id: number }[]>`
    UPDATE public.events
    SET name = 'Cross workspace mutation'
    WHERE workspace_id = ${otherWorkspace.id}
      AND public_id = ${target.public_id}::uuid
    RETURNING id::integer
  `;
  const byLegacyId = await sql<{ id: number }[]>`
    UPDATE public.events
    SET name = 'Cross workspace legacy mutation'
    WHERE workspace_id = ${otherWorkspace.id}
      AND id = ${targetEventId}
    RETURNING id::integer
  `;
  assert.equal(byPublicId.length, 0);
  assert.equal(byLegacyId.length, 0);
}

async function runBlockedProductionEventRace(
  harness: Harness,
  eventId: number,
  firstMutation: () => Promise<unknown>,
  secondMutation: () => Promise<unknown>,
) {
  const blocker = createPostgresTestClient(harness, "postgres", 1);
  const observer = createPostgresTestClient(harness, "postgres", 1);
  const blockerReady = deferred<number>();
  const releaseBlocker = deferred<void>();
  let first: Promise<unknown> | undefined;
  let second: Promise<unknown> | undefined;

  const heldLock = blocker
    .begin(async (transaction) => {
      const [backend] = await transaction<{ pid: number }[]>`
        SELECT pg_backend_pid()::integer AS pid
      `;
      assert.ok(backend);
      const locked = await lockEventRow(transaction, eventId);
      assert.equal(locked.length, 1);
      blockerReady.resolve(backend.pid);
      await releaseBlocker.promise;
    })
    .catch((error) => {
      blockerReady.reject(error);
      throw error;
    });
  void heldLock.catch(() => undefined);

  try {
    await withDeadline(
      blockerReady.promise,
      "Production race blocker did not acquire the event row lock.",
    );
    first = firstMutation();
    void first.catch(() => undefined);
    await waitForBlockedApplicationSessions(
      observer,
      "postgres",
      "public-session-rotation-test",
      1,
    );
    second = secondMutation();
    void second.catch(() => undefined);
    await waitForBlockedApplicationSessions(
      observer,
      "postgres",
      "public-session-rotation-test",
      2,
    );
    releaseBlocker.resolve();
    return await Promise.allSettled([first, second]);
  } finally {
    releaseBlocker.resolve();
    await Promise.allSettled([
      heldLock,
      ...(first ? [first] : []),
      ...(second ? [second] : []),
    ]);
    await Promise.all([
      blocker.end({ timeout: 5 }),
      observer.end({ timeout: 5 }),
    ]);
  }
}

async function waitForBlockedApplicationSessions(
  observer: SqlExecutor,
  database: string,
  applicationName: string,
  expected: number,
) {
  const deadline = Date.now() + concurrencyDeadlineMs;
  while (Date.now() < deadline) {
    const [state] = await observer.unsafe<{ blocked: number }[]>(
      `SELECT count(*)::integer AS blocked
       FROM pg_stat_activity AS waiting
       WHERE waiting.datname = $1
         AND waiting.application_name = $2
         AND waiting.wait_event_type = 'Lock'`,
      [database, applicationName],
    );
    if (state?.blocked === expected) return;
  }
  assert.fail(
    `Expected ${expected} concurrent rotations to wait on the held event row lock.`,
  );
}

async function assertLatestEventAudit(
  sql: postgres.Sql,
  eventId: number,
  action: string,
  expected: {
    operation: string;
    reason: string;
    previousCloseAt: "string" | string | null;
    newCloseAt: string;
  },
) {
  const [audit] = await sql<{ payload: Record<string, unknown> }[]>`
    SELECT payload
    FROM public.operator_audit_log
    WHERE event_id = ${eventId}
      AND action = ${action}
    ORDER BY id DESC
    LIMIT 1
  `;
  assert.ok(audit);
  assertStandardEventAudit(audit.payload, expected.operation);
  assert.equal(audit.payload.reason, expected.reason);
  if (expected.previousCloseAt === "string") {
    assert.equal(typeof audit.payload.previousCloseAt, "string");
  } else {
    assert.equal(audit.payload.previousCloseAt, expected.previousCloseAt);
  }
  assert.equal(audit.payload.newCloseAt, expected.newCloseAt);
}

function assertStandardEventAudit(
  payload: Record<string, unknown>,
  operation: string,
) {
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.targetType, "event");
  assert.equal(payload.outcome, "success");
  assert.equal(payload.operation, operation);
  assert.equal(typeof payload.reason, "string");
  assert.doesNotMatch(
    JSON.stringify(payload),
    /sessionCode|publicToken|sessionUrl|operatorName|authUser|rawError|stack|constraint/i,
  );
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
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), concurrencyDeadlineMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assertRejectedWithCode(
  result: PromiseSettledResult<unknown>,
  status: number,
  code: string,
) {
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(getErrorStatus(result.reason), status);
    assert.equal(getErrorCode(result.reason), code);
  }
}

function randomEightDigitCode(excluded?: string) {
  let code: string;
  do {
    const bytes = randomBytes(4);
    try {
      code = (bytes.readUInt32BE(0) % 100_000_000).toString().padStart(8, "0");
    } finally {
      bytes.fill(0);
    }
  } while (code === excluded);
  return code;
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

async function withApplicationDatabase<T>(
  harness: Harness,
  action: () => Promise<T>,
) {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = postgresTestUrl(harness);
  clearApplicationDatabase();

  try {
    return await action();
  } finally {
    const applicationDatabase = getApplicationDatabase();
    if (applicationDatabase) {
      await applicationDatabase.$client.end({ timeout: 5 });
      clearApplicationDatabase();
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
}

function postgresTestUrl(harness: Harness) {
  const url = new URL("postgresql://127.0.0.1");
  url.port = String(harness.port);
  url.pathname = "/postgres";
  url.username = "postgres";
  url.password = harness.password;
  url.searchParams.set("application_name", "public-session-rotation-test");
  return url.toString();
}

function getApplicationDatabase() {
  return (
    globalThis as typeof globalThis & {
      pozaNutaDatabase?: ApplicationDatabase;
    }
  ).pozaNutaDatabase;
}

function clearApplicationDatabase() {
  delete (
    globalThis as typeof globalThis & {
      pozaNutaDatabase?: ApplicationDatabase;
    }
  ).pozaNutaDatabase;
}
