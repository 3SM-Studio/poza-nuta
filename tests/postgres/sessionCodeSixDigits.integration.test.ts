import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  applyPostgresMigration,
  applyPostgresMigrations,
  createPostgresDatabase,
  createPostgresTestClient,
  dropPostgresDatabase,
  installPostgresCompatibilityFixture,
  postgresDatabaseName,
  removePostgresTestHarness,
  startPostgresTestHarness,
  withPostgresClone,
} from "./postgresTestHarness.ts";

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;
const acceptedCodes = ["004271", "654321", "999999"];
const rejectedRuntimeCodes = [
  "12345",
  "1234567",
  "12345678",
  "abcdef",
  "12 3456",
  "123456\n",
  "١٢٣٤٥٦",
  "１２３４５６",
  "12345６",
];
const unicodeLegacyCodes = ["١٢٣٤٥٦٧٨", "１２３４５６７８", "1234567８"];

for (const image of images) {
  test(`${image}: revised 0027 atomic legacy remediation`, async (context) => {
    const harness = await startPostgresTestHarness(
      "pozanuta-session-code-remediation",
      image,
    );
    const admin = createPostgresTestClient(harness, "postgres", 4);
    const templateDatabase = postgresDatabaseName("session_code_0026");

    try {
      await createPostgresDatabase(admin, templateDatabase);
      const template = createPostgresTestClient(harness, templateDatabase, 2);
      try {
        await installPostgresCompatibilityFixture(template);
        await applyPostgresMigrations(template, 26);
      } finally {
        await template.end({ timeout: 5 });
      }

      await context.test("empty database reaches the final strict-six schema", () =>
        withPostgresClone(
          harness,
          admin,
          templateDatabase,
          "session_code_empty",
          assertEmptyDatabaseMigration,
        ),
      );

      await context.test(
        "production-shaped legacy data is remediated and canonical migrate is idempotent",
        () =>
          withPostgresClone(
            harness,
            admin,
            templateDatabase,
            "session_code_production_shape",
            assertProductionShapedRemediation,
          ),
      );

      await context.test("active event fails before remediation", () =>
        withPostgresClone(
          harness,
          admin,
          templateDatabase,
          "session_code_active_blocker",
          (sql) => assertLifecycleBlocker(sql, "active"),
        ),
      );

      await context.test("scheduled event fails before remediation", () =>
        withPostgresClone(
          harness,
          admin,
          templateDatabase,
          "session_code_scheduled_blocker",
          (sql) => assertLifecycleBlocker(sql, "scheduled"),
        ),
      );

      await context.test("broken current-history pairing fails closed", () =>
        withPostgresClone(
          harness,
          admin,
          templateDatabase,
          "session_code_pairing_blocker",
          assertBrokenPairingBlocker,
        ),
      );

      await context.test("failure after DDL rolls the entire migration back", () =>
        withPostgresClone(
          harness,
          admin,
          templateDatabase,
          "session_code_atomic_rollback",
          assertPostDdlRollback,
        ),
      );

      await context.test("concurrent session delete drains before the locked recheck", () =>
        withPostgresClone(
          harness,
          admin,
          templateDatabase,
          "session_code_delete_first",
          (sql, database) => assertDeleteBeforeMigrationLock(sql, harness, database),
        ),
      );

      await context.test("migration session lock blocks a later delete", () =>
        withPostgresClone(
          harness,
          admin,
          templateDatabase,
          "session_code_migration_first",
          (sql, database) => assertMigrationLockBeforeDelete(sql, harness, database),
        ),
      );
    } finally {
      await dropPostgresDatabase(admin, templateDatabase);
      await admin.end({ timeout: 5 });
      await removePostgresTestHarness(harness.containerName);
    }
  });
}

async function assertEmptyDatabaseMigration(sql: postgres.Sql) {
  await applyPostgresMigration(sql, 27);

  const [counts] = await sql<{ events: number; history: number }[]>`
    SELECT
      (SELECT count(*)::integer FROM public.events) AS events,
      (SELECT count(*)::integer FROM public.event_session_codes) AS history
  `;
  assert.deepEqual(counts, { events: 0, history: 0 });
  assert.equal(await legacyColumnExists(sql), true);
  assert.deepEqual(await constraintValidationState(sql), [
    { table_name: "event_session_codes", constraint_name: "event_session_codes_code_format_check", validated: false },
    { table_name: "event_session_codes", constraint_name: "event_session_codes_legacy_code_format_check", validated: false },
    { table_name: "events", constraint_name: "events_session_code_format_check", validated: false },
  ]);

  await validateFormatConstraints(sql);
  assert.ok((await constraintValidationState(sql)).every(({ validated }) => validated));
}

async function assertProductionShapedRemediation(sql: postgres.Sql) {
  const workspaceId = await createWorkspace(sql, "production-shape");
  const fixture = await createProductionShapedFixture(sql, workspaceId);

  const migration = await applyCanonicalMigrationExactlyOnce(sql);
  assert.match(migration.hash, /^[0-9a-f]{64}$/);

  const history = await sql<{
    code: string;
    legacy_code: string;
    revoked_at_text: string | null;
    valid_until_text: string | null;
    release_after_text: string | null;
  }[]>`
    SELECT code,
           legacy_code,
           revoked_at::text AS revoked_at_text,
           valid_until::text AS valid_until_text,
           release_after::text AS release_after_text
    FROM public.event_session_codes
    ORDER BY legacy_code
  `;
  assert.equal(history.length, 29);
  assert.deepEqual(
    history.map(({ code }) => code),
    Array.from({ length: 29 }, (_, index) => String(index).padStart(6, "0")),
  );
  assert.deepEqual(
    history.map(({ legacy_code }) => legacy_code),
    [...fixture.currentLegacyCodes, fixture.revokedLegacyCode].sort(),
  );
  assert.ok(history.every(({ code }) => /^[0-9]{6}$/.test(code)));
  assert.ok(history.every(({ legacy_code }) => /^[0-9]{8}$/.test(legacy_code)));
  assert.equal(new Set(history.map(({ code }) => code)).size, 29);
  assert.equal(new Set(history.map(({ legacy_code }) => legacy_code)).size, 29);

  const revoked = history.find(
    ({ legacy_code }) => legacy_code === fixture.revokedLegacyCode,
  );
  assert.ok(revoked);
  assert.ok(revoked.revoked_at_text);
  assert.ok(revoked.valid_until_text);
  assert.equal(revoked.revoked_at_text, revoked.valid_until_text);
  assert.equal(revoked.release_after_text, fixture.revokedReleaseAfterText);

  const [runtimeState] = await sql<{
    event_total: number;
    history_total: number;
    invalid_events: number;
    invalid_history: number;
    runtime_eight_digit_rows: number;
    paired_current_rows: number;
    distinct_history_codes: number;
    distinct_legacy_codes: number;
  }[]>`
    SELECT
      (SELECT count(*)::integer FROM public.events) AS event_total,
      (SELECT count(*)::integer FROM public.event_session_codes) AS history_total,
      (SELECT count(*)::integer FROM public.events
       WHERE length(session_code) <> 6
          OR octet_length(translate(session_code, '0123456789', '')) <> 0) AS invalid_events,
      (SELECT count(*)::integer FROM public.event_session_codes
       WHERE length(code) <> 6
          OR octet_length(translate(code, '0123456789', '')) <> 0) AS invalid_history,
      (SELECT count(*)::integer
       FROM (
         SELECT session_code AS code FROM public.events
         UNION ALL
         SELECT code FROM public.event_session_codes
       ) AS runtime_codes
       WHERE length(code) = 8
         AND octet_length(translate(code, '0123456789', '')) = 0) AS runtime_eight_digit_rows,
      (SELECT count(*)::integer
       FROM public.events AS event
       JOIN public.event_sessions AS session ON session.event_id = event.id
       JOIN public.event_session_codes AS history
         ON history.session_id = session.id
        AND history.valid_until IS NULL
        AND history.revoked_at IS NULL
        AND history.code = event.session_code) AS paired_current_rows,
      (SELECT count(DISTINCT code)::integer FROM public.event_session_codes) AS distinct_history_codes,
      (SELECT count(DISTINCT legacy_code)::integer FROM public.event_session_codes) AS distinct_legacy_codes
  `;
  assert.deepEqual(runtimeState, {
    event_total: 28,
    history_total: 29,
    invalid_events: 0,
    invalid_history: 0,
    runtime_eight_digit_rows: 0,
    paired_current_rows: 28,
    distinct_history_codes: 29,
    distinct_legacy_codes: 29,
  });

  const [eventsLegacyColumn] = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'legacy_code'
  `;
  assert.equal(eventsLegacyColumn.count, 0);

  await assertFinalWriteContract(sql, workspaceId, fixture.currentLegacyCodes[0]);
  await validateFormatConstraints(sql);
  assert.ok((await constraintValidationState(sql)).every(({ validated }) => validated));
}

async function assertLifecycleBlocker(
  sql: postgres.Sql,
  lifecycle: "active" | "scheduled",
) {
  const workspaceId = await createWorkspace(sql, `${lifecycle}-blocker`);
  const code = lifecycle === "active" ? "31000000" : "32000000";
  await insertLegacyIdentity(sql, workspaceId, code, `${lifecycle} event`, lifecycle);

  await assert.rejects(
    applyPostgresMigration(sql, 27),
    (error: unknown) =>
      isPostgresError(
        error,
        "55000",
        "session_code_legacy_active_event_preflight",
      ),
  );
  await assertPre0027State(sql, [code]);
}

async function assertBrokenPairingBlocker(sql: postgres.Sql) {
  const workspaceId = await createWorkspace(sql, "pairing-blocker");
  const identity = await insertLegacyIdentity(
    sql,
    workspaceId,
    "33000000",
    "Broken pairing",
    "closed",
  );
  await sql`
    UPDATE public.events
    SET session_code = '33000001'
    WHERE id = ${identity.eventId}
  `;

  await assert.rejects(
    applyPostgresMigration(sql, 27),
    (error: unknown) =>
      isPostgresError(
        error,
        "23514",
        "session_code_legacy_pairing_preflight",
      ),
  );
  await assertPre0027State(sql, ["33000001"], ["33000000"]);
}

async function assertPostDdlRollback(sql: postgres.Sql) {
  const workspaceId = await createWorkspace(sql, "post-ddl-rollback");
  const code = "34000000";
  await insertLegacyIdentity(
    sql,
    workspaceId,
    code,
    "Post DDL rollback",
    "closed",
  );
  const { previous, current } = await seedCanonicalMigrationRegistry(sql);
  const source = readFileSync("drizzle/0027_session_code_6_digits.sql", "utf8");
  const failingSql = injectStatementAfter(
    source,
    'WHERE "legacy_code" IS NOT NULL;\n--> statement-breakpoint',
    "DO $$ BEGIN RAISE EXCEPTION 'injected remediation failure'; END; $$;",
  );

  await withMigrationVariant(failingSql, async (folder) => {
    await assert.rejects(
      migrate(drizzle(sql), { migrationsFolder: folder }),
      /injected remediation failure/,
    );
  });

  await assertPre0027State(sql, [code]);
  await assertPre0027Indexes(sql);
  await assertOnlyPreviousRegistryRow(sql, previous.hash, previous.folderMillis);

  // A second canonical run must see the pre-0027 state and apply the real 0027.
  const database = drizzle(sql);
  await migrate(database, { migrationsFolder: "drizzle" });
  await migrate(database, { migrationsFolder: "drizzle" });
  const [remediated] = await sql<{ code: string; legacy_code: string }[]>`
    SELECT code, legacy_code FROM public.event_session_codes
  `;
  assert.deepEqual(remediated, { code: "000000", legacy_code: code });
  await assertCurrentRegistryRowExactlyOnce(sql, current.hash, current.folderMillis);
}

async function assertDeleteBeforeMigrationLock(
  sql: postgres.Sql,
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  databaseName: string,
) {
  const workspaceId = await createWorkspace(sql, "delete-first");
  const code = "35000000";
  const identity = await insertLegacyIdentity(sql, workspaceId, code, "Delete first", "closed");
  const { previous } = await seedCanonicalMigrationRegistry(sql);
  const deleter = createPostgresTestClient(harness, databaseName, 1);
  const deletionStarted = deferred<void>();
  const releaseDelete = deferred<void>();
  const deletionOutcome = deleter.begin(async (transaction) => {
    await transaction`DELETE FROM public.event_sessions WHERE id = ${identity.sessionId}`;
    deletionStarted.resolve();
    await releaseDelete.promise;
  }).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));

  try {
    await deletionStarted.promise;
    const migrationOutcome = migrate(drizzle(sql), { migrationsFolder: "drizzle" })
      .then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
    await waitForRelationLock(sql, "event_sessions", "ShareLock", false);
    releaseDelete.resolve();
    assert.equal((await deletionOutcome).ok, true);
    const result = await migrationOutcome;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        isPostgresError(result.error, "55000", "session_code_legacy_locked_recheck"),
        `Unexpected migration SQLSTATE/constraint: ${postgresErrorIdentity(result.error)}`,
      );
    }
    await assertPre0027State(sql, [code], []);
    await assertOnlyPreviousRegistryRow(sql, previous.hash, previous.folderMillis);
  } finally {
    releaseDelete.resolve();
    await deletionOutcome;
    await deleter.end({ timeout: 5 });
  }
}

async function assertMigrationLockBeforeDelete(
  sql: postgres.Sql,
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  databaseName: string,
) {
  const workspaceId = await createWorkspace(sql, "migration-first");
  const code = "36000000";
  const identity = await insertLegacyIdentity(sql, workspaceId, code, "Migration first", "closed");
  await seedCanonicalMigrationRegistry(sql);

  const source = readFileSync("drizzle/0027_session_code_6_digits.sql", "utf8");
  const barrierKey = 270027;
  const pausedSql = injectStatementAfter(
    source,
    'DROP CONSTRAINT "event_session_codes_code_format_check";\n--> statement-breakpoint',
    `SELECT pg_advisory_xact_lock(${barrierKey});`,
  );

  await withMigrationVariant(pausedSql, async (folder) => {
    const barrier = createPostgresTestClient(harness, databaseName, 1);
    const deleter = createPostgresTestClient(harness, databaseName, 1);
    const barrierReady = deferred<void>();
    const releaseBarrier = deferred<void>();
    const expectedRollback = new Error("intentional concurrent delete rollback");
    const barrierOutcome = barrier.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(${barrierKey})`;
      barrierReady.resolve();
      await releaseBarrier.promise;
    }).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));

    try {
      await barrierReady.promise;
      const migrationOutcome = migrate(drizzle(sql), { migrationsFolder: folder })
        .then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
      await waitForAdvisoryWait(sql);

      const deletePid = deferred<number>();
      const deletionOutcome = deleter.begin(async (transaction) => {
        const [row] = await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        deletePid.resolve(row.pid);
        await transaction`DELETE FROM public.event_sessions WHERE id = ${identity.sessionId}`;
        throw expectedRollback;
      }).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));

      const outcome = await waitForDeleteLockOutcome(sql, await deletePid.promise);
      assert.equal(outcome, "blocked-on-session");
      await waitForRelationLock(sql, "event_sessions", "ShareLock", true);
      releaseBarrier.resolve();
      assert.equal((await barrierOutcome).ok, true);
      const migrationResult = await migrationOutcome;
      assert.equal(migrationResult.ok, true, migrationResult.ok ? undefined : String(migrationResult.error));
      const deletionResult = await deletionOutcome;
      assert.equal(deletionResult.ok, false);
      if (!deletionResult.ok) assert.equal(deletionResult.error, expectedRollback);
    } finally {
      releaseBarrier.resolve();
      await barrierOutcome;
      await barrier.end({ timeout: 5 });
      await deleter.end({ timeout: 5 });
    }
  });

  const [row] = await sql<{ session_code: string; history_code: string }[]>`
    SELECT event.session_code, history.code AS history_code
    FROM public.events AS event
    JOIN public.event_sessions AS session ON session.event_id = event.id
    JOIN public.event_session_codes AS history ON history.session_id = session.id
    WHERE event.id = ${identity.eventId}
  `;
  assert.deepEqual(row, { session_code: "000000", history_code: "000000" });
}

async function createProductionShapedFixture(
  sql: postgres.Sql,
  workspaceId: number,
) {
  const currentLegacyCodes = Array.from(
    { length: 28 },
    (_, index) => String(10_000_000 + index),
  );
  const identities = [];

  for (const [index, code] of currentLegacyCodes.entries()) {
    identities.push(
      await insertLegacyIdentity(
        sql,
        workspaceId,
        code,
        `Legacy event ${index}`,
        index % 2 === 0 ? "closed" : "cancelled",
      ),
    );
  }

  const revokedLegacyCode = "20000000";
  const [revoked] = await sql<{ release_after_text: string }[]>`
    INSERT INTO public.event_session_codes (
      session_id,
      code,
      valid_from,
      valid_until,
      revoked_at,
      release_after,
      rotation_reason
    )
    VALUES (
      ${identities[0].sessionId},
      ${revokedLegacyCode},
      now() - interval '3 days',
      now() - interval '2 days',
      now() - interval '2 days',
      now() + interval '400 days',
      'operator_rotation'
    )
    RETURNING release_after::text AS release_after_text
  `;
  assert.ok(revoked);

  return {
    currentLegacyCodes,
    revokedLegacyCode,
    revokedReleaseAfterText: revoked.release_after_text,
  };
}

async function assertFinalWriteContract(
  sql: postgres.Sql,
  workspaceId: number,
  existingLegacyCode: string,
) {
  for (const [index, code] of acceptedCodes.entries()) {
    const identity = await insertStrictIdentity(
      sql,
      workspaceId,
      code,
      `Accepted strict code ${index}`,
    );
    assert.equal(identity.eventCode, code);
    assert.equal(identity.historyCode, code);
    assert.equal(identity.legacyCode, null);
  }

  for (const [index, code] of rejectedRuntimeCodes.entries()) {
    await assert.rejects(
      insertStrictEvent(sql, workspaceId, code, `Rejected event ${index}`),
      (error: unknown) =>
        isPostgresError(error, "23514", "events_session_code_format_check"),
    );

    const holderCode = String(700_000 + index).padStart(6, "0");
    const holder = await insertStrictEvent(
      sql,
      workspaceId,
      holderCode,
      `Rejected history holder ${index}`,
    );
    const sessionId = await insertSession(sql, holder.id);
    await assert.rejects(
      sql`
        INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
        VALUES (${sessionId}, ${code}, 'initial')
      `,
      (error: unknown) =>
        isPostgresError(
          error,
          "23514",
          "event_session_codes_code_format_check",
        ),
    );
  }

  const [defaulted] = await sql<{ session_code: string }[]>`
    INSERT INTO public.events (workspace_id, name, starts_at, ends_at)
    VALUES (${workspaceId}, 'Default six digits', now(), now() + interval '1 hour')
    RETURNING session_code
  `;
  assert.match(defaulted.session_code, /^[0-9]{6}$/);

  const [newHistory] = await sql<{ id: number }[]>`
    SELECT id::integer
    FROM public.event_session_codes
    WHERE code = ${acceptedCodes[0]}
  `;
  assert.ok(newHistory);

  for (const legacyCode of unicodeLegacyCodes) {
    await assert.rejects(
      sql`
        UPDATE public.event_session_codes
        SET legacy_code = ${legacyCode}
        WHERE id = ${newHistory.id}
      `,
      (error: unknown) =>
        isPostgresError(
          error,
          "23514",
          "event_session_codes_legacy_code_format_check",
        ),
    );
  }

  await assert.rejects(
    sql`
      UPDATE public.event_session_codes
      SET legacy_code = ${existingLegacyCode}
      WHERE id = ${newHistory.id}
    `,
    (error: unknown) =>
      isPostgresError(error, "23505", "event_session_codes_legacy_code_idx"),
  );

  await assert.rejects(
    insertStrictEvent(sql, workspaceId, "000000", "Reused current mapped code"),
    (error: unknown) => isPostgresError(error, "23505", "events_session_code_idx"),
  );

  const historyCollisionHolder = await insertStrictEvent(
    sql,
    workspaceId,
    "880000",
    "History collision holder",
  );
  const historyCollisionSession = await insertSession(
    sql,
    historyCollisionHolder.id,
  );
  await assert.rejects(
    sql`
      INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
      VALUES (${historyCollisionSession}, '000028', 'initial')
    `,
    (error: unknown) =>
      isPostgresError(error, "23505", "event_session_codes_code_idx"),
  );
}

async function assertPre0027State(
  sql: postgres.Sql,
  expectedEventCodes: string[],
  expectedHistoryCodes = expectedEventCodes,
) {
  assert.equal(await legacyColumnExists(sql), false);

  const [state] = await sql<{
    event_constraint: string;
    event_validated: boolean;
    history_constraint: string;
    history_validated: boolean;
    event_default: string;
  }[]>`
    SELECT
      pg_get_constraintdef(event_constraint.oid) AS event_constraint,
      event_constraint.convalidated AS event_validated,
      pg_get_constraintdef(history_constraint.oid) AS history_constraint,
      history_constraint.convalidated AS history_validated,
      (
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'events'
          AND column_name = 'session_code'
      ) AS event_default
    FROM pg_constraint AS event_constraint
    CROSS JOIN pg_constraint AS history_constraint
    WHERE event_constraint.conrelid = 'public.events'::regclass
      AND event_constraint.conname = 'events_session_code_format_check'
      AND history_constraint.conrelid = 'public.event_session_codes'::regclass
      AND history_constraint.conname = 'event_session_codes_code_format_check'
  `;
  assert.match(state.event_constraint, /\[0-9\]\{8\}/);
  assert.match(state.history_constraint, /\[0-9\]\{8\}/);
  assert.equal(state.event_validated, true);
  assert.equal(state.history_validated, true);
  assert.match(state.event_default, /100000000/);

  const events = await sql<{ session_code: string }[]>`
    SELECT session_code FROM public.events ORDER BY session_code
  `;
  const history = await sql<{ code: string }[]>`
    SELECT code FROM public.event_session_codes ORDER BY code
  `;
  assert.deepEqual(events.map(({ session_code }) => session_code), [...expectedEventCodes].sort());
  assert.deepEqual(history.map(({ code }) => code), [...expectedHistoryCodes].sort());
}

async function applyCanonicalMigrationExactlyOnce(sql: postgres.Sql) {
  const { previous, current } = await seedCanonicalMigrationRegistry(sql);
  assert.ok(current.folderMillis > previous.folderMillis);

  const database = drizzle(sql);
  await migrate(database, { migrationsFolder: "drizzle" });
  await migrate(database, { migrationsFolder: "drizzle" });
  await assertCurrentRegistryRowExactlyOnce(sql, current.hash, current.folderMillis);

  return current;
}

async function seedCanonicalMigrationRegistry(sql: postgres.Sql) {
  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  const previous = migrations[26];
  const current = migrations[27];
  assert.ok(previous);
  assert.ok(current);
  assert.match(current.sql.join("\n"), /session_code_legacy_mapping/);
  assert.match(current.hash, /^[0-9a-f]{64}$/);

  await sql.unsafe("CREATE SCHEMA drizzle");
  await sql.unsafe(`
    CREATE TABLE drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  await sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${previous.hash}, ${previous.folderMillis})
  `;

  return { previous, current };
}

async function assertOnlyPreviousRegistryRow(
  sql: postgres.Sql,
  previousHash: string,
  previousMillis: number,
) {
  const rows = await sql<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id
  `;
  assert.deepEqual([...rows], [{ hash: previousHash, created_at: String(previousMillis) }]);
}

async function assertCurrentRegistryRowExactlyOnce(
  sql: postgres.Sql,
  currentHash: string,
  currentMillis: number,
) {
  const rows = await sql<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at::text
    FROM drizzle.__drizzle_migrations
    WHERE created_at = ${currentMillis}
  `;
  assert.deepEqual([...rows], [{ hash: currentHash, created_at: String(currentMillis) }]);
}

async function assertPre0027Indexes(sql: postgres.Sql) {
  const rows = await sql<{
    index_name: string;
    is_unique: boolean;
    is_valid: boolean;
    is_ready: boolean;
    definition: string;
  }[]>`
    SELECT index_relation.relname AS index_name,
           index_metadata.indisunique AS is_unique,
           index_metadata.indisvalid AS is_valid,
           index_metadata.indisready AS is_ready,
           pg_get_indexdef(index_metadata.indexrelid) AS definition
    FROM pg_index AS index_metadata
    JOIN pg_class AS index_relation ON index_relation.oid = index_metadata.indexrelid
    JOIN pg_namespace AS index_schema ON index_schema.oid = index_relation.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname IN (
        'events_session_code_idx',
        'event_sessions_event_id_idx',
        'event_session_codes_code_idx',
        'event_session_codes_current_session_idx',
        'event_session_codes_legacy_code_idx'
      )
  `;
  const byName = new Map(rows.map((row) => [row.index_name, row]));
  assert.equal(byName.has("event_session_codes_legacy_code_idx"), false);
  for (const [name, column] of [
    ["events_session_code_idx", "session_code"],
    ["event_sessions_event_id_idx", "event_id"],
    ["event_session_codes_code_idx", "code"],
    ["event_session_codes_current_session_idx", "session_id"],
  ]) {
    const row = byName.get(name);
    assert.ok(row, `${name} must survive rollback`);
    assert.equal(row.is_unique, true);
    assert.equal(row.is_valid, true);
    assert.equal(row.is_ready, true);
    assert.match(row.definition, new RegExp(`\\(${column}\\)`));
  }
  const currentIndex = byName.get("event_session_codes_current_session_idx");
  assert.ok(currentIndex);
  assert.match(currentIndex.definition, /valid_until IS NULL.*revoked_at IS NULL/i);
}

function injectStatementAfter(source: string, marker: string, statement: string) {
  assert.equal(source.split(marker).length, 2, "the migration insertion point must be unique");
  return source.replace(marker, `${marker}\n${statement}\n--> statement-breakpoint`);
}

async function withMigrationVariant<T>(
  migrationSql: string,
  callback: (folder: string) => Promise<T>,
): Promise<T> {
  const temporaryRoot = realpathSync(tmpdir());
  const folder = mkdtempSync(join(temporaryRoot, "pozanuta-0027-"));
  try {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string; when: number; version: string; breakpoints: boolean }>;
    };
    const entry = journal.entries.find(({ idx }) => idx === 27);
    assert.ok(entry);
    mkdirSync(join(folder, "meta"));
    writeFileSync(
      join(folder, "meta", "_journal.json"),
      JSON.stringify({ ...journal, entries: [entry] }),
    );
    writeFileSync(join(folder, `${entry.tag}.sql`), migrationSql);
    return await callback(folder);
  } finally {
    const target = realpathSync(folder);
    assert.equal(dirname(target), temporaryRoot);
    assert.ok(basename(target).startsWith("pozanuta-0027-"));
    rmSync(target, { recursive: true, force: true });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function waitForRelationLock(
  sql: postgres.Sql,
  table: "event_sessions",
  mode: "ShareLock",
  granted: boolean,
) {
  const deadline = Date.now() + 3_500;
  while (Date.now() < deadline) {
    const [row] = await sql<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE relation = ${`public.${table}`}::regclass
          AND mode = ${mode}
          AND granted = ${granted}
          AND pid <> pg_backend_pid()
      ) AS found
    `;
    if (row.found) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for ${mode} on ${table} (granted=${granted})`);
}

async function waitForAdvisoryWait(sql: postgres.Sql) {
  const deadline = Date.now() + 3_500;
  while (Date.now() < deadline) {
    const [row] = await sql<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND pid <> pg_backend_pid()
      ) AS found
    `;
    if (row.found) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for the migration advisory barrier");
}

async function waitForDeleteLockOutcome(sql: postgres.Sql, pid: number) {
  const deadline = Date.now() + 3_500;
  while (Date.now() < deadline) {
    const rows = await sql<{ relation_name: string; mode: string }[]>`
      SELECT relation::regclass::text AS relation_name, mode
      FROM pg_locks
      WHERE pid = ${pid}
        AND mode = 'RowExclusiveLock'
        AND NOT granted
        AND relation IN (
          'public.event_sessions'::regclass,
          'public.event_session_codes'::regclass
        )
    `;
    if (rows.some(({ relation_name }) => relation_name.endsWith("event_sessions"))) {
      return "blocked-on-session";
    }
    if (rows.some(({ relation_name }) => relation_name.endsWith("event_session_codes"))) {
      return "blocked-on-history";
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for the concurrent DELETE lock outcome");
}

async function validateFormatConstraints(sql: postgres.Sql) {
  await sql.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL lock_timeout = '5s'");
    await transaction.unsafe("SET LOCAL statement_timeout = '30s'");
    await transaction.unsafe(`
      ALTER TABLE public.event_session_codes
        VALIDATE CONSTRAINT event_session_codes_code_format_check
    `);
    await transaction.unsafe(`
      ALTER TABLE public.event_session_codes
        VALIDATE CONSTRAINT event_session_codes_legacy_code_format_check
    `);
    await transaction.unsafe(`
      ALTER TABLE public.events
        VALIDATE CONSTRAINT events_session_code_format_check
    `);
  });
}

async function constraintValidationState(sql: postgres.Sql) {
  const rows = await sql<{
    table_name: string;
    constraint_name: string;
    validated: boolean;
  }[]>`
    SELECT table_relation.relname AS table_name,
           constraint_metadata.conname AS constraint_name,
           constraint_metadata.convalidated AS validated
    FROM pg_constraint AS constraint_metadata
    JOIN pg_class AS table_relation
      ON table_relation.oid = constraint_metadata.conrelid
    JOIN pg_namespace AS table_schema
      ON table_schema.oid = table_relation.relnamespace
    WHERE table_schema.nspname = 'public'
      AND (table_relation.relname, constraint_metadata.conname) IN (
        ('events', 'events_session_code_format_check'),
        ('event_session_codes', 'event_session_codes_code_format_check'),
        ('event_session_codes', 'event_session_codes_legacy_code_format_check')
      )
    ORDER BY table_relation.relname, constraint_metadata.conname
  `;
  return [...rows];
}

async function legacyColumnExists(sql: postgres.Sql) {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'event_session_codes'
        AND column_name = 'legacy_code'
    ) AS exists
  `;
  return row.exists;
}

async function createWorkspace(sql: postgres.Sql, suffix: string) {
  const compactSuffix = suffix.replaceAll("-", "");
  const publicId = `sessioncode${compactSuffix.slice(0, 9).padEnd(9, "x")}`;
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (public_id, name, handle)
    VALUES (
      ${publicId},
      ${`Session code ${suffix}`},
      ${`session-code-${suffix}`}
    )
    RETURNING id::integer
  `;
  assert.ok(workspace);
  return workspace.id;
}

async function insertLegacyIdentity(
  sql: postgres.Sql,
  workspaceId: number,
  code: string,
  name: string,
  lifecycle: "closed" | "cancelled" | "active" | "scheduled",
) {
  const [event] = await sql<{ id: number; session_code: string }[]>`
    INSERT INTO public.events (
      workspace_id,
      name,
      session_code,
      starts_at,
      ends_at,
      status,
      closed_at,
      close_reason
    )
    VALUES (
      ${workspaceId},
      ${name},
      ${code},
      CASE WHEN ${lifecycle} = 'scheduled' THEN now() + interval '1 day' ELSE now() - interval '2 days' END,
      CASE WHEN ${lifecycle} IN ('active', 'scheduled') THEN now() + interval '2 days' ELSE now() - interval '1 day' END,
      ${lifecycle === "scheduled" ? "draft" : lifecycle}::public.event_status,
      CASE WHEN ${lifecycle} = 'closed' THEN now() - interval '1 day' ELSE NULL END,
      CASE WHEN ${lifecycle} = 'closed' THEN 'automatic' ELSE NULL END
    )
    RETURNING id::integer, session_code
  `;
  assert.ok(event);
  const sessionId = await insertSession(sql, event.id);
  const [history] = await sql<{ id: number; code: string }[]>`
    INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
    VALUES (${sessionId}, ${code}, 'initial')
    RETURNING id::integer, code
  `;
  assert.ok(history);
  return {
    eventId: event.id,
    sessionId,
    historyId: history.id,
    eventCode: event.session_code,
    historyCode: history.code,
  };
}

async function insertStrictIdentity(
  sql: postgres.Sql,
  workspaceId: number,
  code: string,
  name: string,
) {
  const event = await insertStrictEvent(sql, workspaceId, code, name);
  const sessionId = await insertSession(sql, event.id);
  const [history] = await sql<{
    code: string;
    legacy_code: string | null;
  }[]>`
    INSERT INTO public.event_session_codes (session_id, code, rotation_reason)
    VALUES (${sessionId}, ${code}, 'initial')
    RETURNING code, legacy_code
  `;
  assert.ok(history);
  return {
    eventCode: event.sessionCode,
    historyCode: history.code,
    legacyCode: history.legacy_code,
  };
}

async function insertStrictEvent(
  sql: postgres.Sql,
  workspaceId: number,
  code: string,
  name: string,
) {
  const [event] = await sql<{ id: number; session_code: string }[]>`
    INSERT INTO public.events (workspace_id, name, session_code, starts_at, ends_at)
    VALUES (${workspaceId}, ${name}, ${code}, now(), now() + interval '1 hour')
    RETURNING id::integer, session_code
  `;
  assert.ok(event);
  return { id: event.id, sessionCode: event.session_code };
}

async function insertSession(sql: postgres.Sql, eventId: number) {
  const publicToken = randomBytes(16).toString("base64url");
  const [session] = await sql<{ id: number }[]>`
    INSERT INTO public.event_sessions (event_id, public_token)
    VALUES (${eventId}, ${publicToken})
    RETURNING id::integer
  `;
  assert.ok(session);
  return session.id;
}

function isPostgresError(error: unknown, code: string, constraint: string) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if (
      "code" in current && current.code === code &&
      "constraint_name" in current && current.constraint_name === constraint
    ) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function postgresErrorIdentity(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    const value = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (value.code !== undefined) {
      return `${String(value.code)} / ${String(value.constraint_name)}`;
    }
    current = value.cause;
  }
  return "non-Postgres error";
}
