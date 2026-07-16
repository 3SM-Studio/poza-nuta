import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import * as schema from "../../src/db/schema.ts";
import {
  enqueueImportJobWithDependencies,
  requestImportCancellationWithDependencies,
  type ImportJobMutationDependencies,
} from "../../src/server/platform-admin/import-job-core.ts";
import { createImportJobTransactionStore } from "../../src/server/platform-admin/import-job-store.ts";
import {
  completeImportJob,
  failImportJob,
  heartbeatImportJob,
  recoverExpiredImportJobs,
  updateImportJobProgress,
  type ImportWorkerDependencies,
} from "../../src/server/platform-admin/import-worker-core.ts";
import { createImportWorkerTransactionStore } from "../../src/server/platform-admin/import-worker-store.ts";
import {
  applyPostgresMigration,
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

type PgFailure = Error & { code?: string; constraint_name?: string };
type Database = ReturnType<typeof databaseFor>;

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;
const firstToken = "00000000-0000-4000-8000-000000000101";
const secondToken = "00000000-0000-4000-8000-000000000102";
const thirdToken = "00000000-0000-4000-8000-000000000103";

test(
  "0019 provides durable import worker services on PostgreSQL 15 and 17",
  { timeout: 1_200_000 },
  async (context) => {
    for (const image of images) {
      await context.test(image, async () => verifyOnImage(image));
    }
  },
);

async function verifyOnImage(image: (typeof images)[number]) {
  const version = image.startsWith("postgres:15") ? "15" : "17";
  const harness = await startPostgresTestHarness(
    `pozanuta-import-worker-pg${version}`,
    image,
  );
  const admin = createPostgresTestClient(harness, "postgres");
  const databaseName = postgresDatabaseName(`import_worker_pg${version}`);

  try {
    await createPostgresDatabase(admin, databaseName);
    const sql = createPostgresTestClient(harness, databaseName, 8);
    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 18);
      await assertActiveJobFailFast(sql);
      const seeded = await seedPreMigrationData(sql);
      const rowsBefore = await readPreservedRows(sql, seeded);
      await applyPostgresMigration(sql, 19);
      await assertMigrationContract(sql, seeded, rowsBefore);
      await assertWorkerStateConstraints(sql);
      await assertPlatformServices(sql, seeded.operatorId);
      await assertWorkerLifecycle(sql);
      await assertDeterministicClaimCancelRace(
        harness,
        databaseName,
        seeded.operatorId,
      );
      await assertStaleClaimAndRecovery(sql);
      await assertAuditRollback(sql);
      await assertTerminalImmutability(sql);
      await assertWorkerPrivileges(
        harness,
        databaseName,
        sql,
        seeded.operatorId,
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await dropPostgresDatabase(admin, databaseName);
    await admin.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }

  assert.equal(await postgresTestContainerExists(harness.containerName), false);
}

async function assertActiveJobFailFast(sql: postgres.Sql) {
  const [active] = await sql<{ id: number }[]>`
    INSERT INTO import_jobs (
      source, status, mode, initiator_kind,
      total_rows, processed_count, imported_count, skipped_count, error_count,
      created_at, updated_at
    ) VALUES (
      'ising', 'queued', 'write', 'system',
      0, 0, 0, 0, 0, clock_timestamp(), clock_timestamp()
    )
    RETURNING id::int AS id
  `;
  assert.ok(active);
  await assert.rejects(
    applyPostgresMigration(sql, 19),
    (error: PgFailure) =>
      error.code === "23514" &&
      error.constraint_name === "import_job_worker_migration_active_jobs",
  );
  assert.equal(await objectExists(sql, "public.audit_actor_kind"), false);
  await sql`DELETE FROM import_jobs WHERE id = ${active.id}`;
}

async function seedPreMigrationData(sql: postgres.Sql) {
  const [operator] = await sql<{ id: number }[]>`
    INSERT INTO operator_users (name, password_hash)
    VALUES ('Worker Foundation Owner', 'not-used-by-test')
    RETURNING id::int AS id
  `;
  assert.ok(operator);
  await sql`
    INSERT INTO platform_members (operator_user_id, role, active)
    VALUES (${operator.id}, 'platform_owner', true)
  `;
  const auditRows = await sql<{ id: number }[]>`
    INSERT INTO operator_audit_log (operator_id, action, entity_id, payload)
    VALUES
      (${operator.id}, 'pre_worker_operator', 'operator', '{}'::jsonb),
      (NULL, 'pre_worker_system', 'legacy', '{}'::jsonb)
    RETURNING id::int AS id
  `;
  const jobs = await sql<{ id: number }[]>`
    INSERT INTO import_jobs (
      source, status, mode, initiator_kind, started_by_operator_id,
      total_rows, processed_count, imported_count, skipped_count, error_count,
      safe_error_code, safe_error_summary,
      created_at, started_at, finished_at, updated_at
    ) VALUES
      (
        'ising', 'succeeded', 'write', 'operator', ${operator.id},
        2, 2, 2, 0, 0, NULL, NULL,
        '2026-07-16T10:00:00Z', '2026-07-16T10:01:00Z',
        '2026-07-16T10:02:00Z', '2026-07-16T10:03:00Z'
      ),
      (
        'karafun', 'failed', 'write', 'legacy', NULL,
        1, 1, 0, 0, 1, 'LEGACY_FAILURE', 'A legacy import failed safely.',
        '2026-07-16T11:00:00Z', '2026-07-16T11:01:00Z',
        '2026-07-16T11:02:00Z', '2026-07-16T11:03:00Z'
      )
    RETURNING id::int AS id
  `;
  return {
    operatorId: operator.id,
    auditIds: auditRows.map(({ id }) => id),
    jobIds: jobs.map(({ id }) => id),
  };
}

async function readPreservedRows(
  sql: postgres.Sql,
  seeded: { auditIds: number[]; jobIds: number[] },
) {
  return {
    jobs: await sql`
      SELECT id::int, source::text, status::text, total_rows,
        processed_count, imported_count, skipped_count, error_count,
        safe_error_code, safe_error_summary, created_at::text,
        started_at::text, finished_at::text, updated_at::text
      FROM import_jobs WHERE id = ANY(${seeded.jobIds}::bigint[]) ORDER BY id
    `,
    audits: await sql`
      SELECT id::int, operator_id::int, action, entity_id, payload
      FROM operator_audit_log
      WHERE id = ANY(${seeded.auditIds}::bigint[]) ORDER BY id
    `,
  };
}

async function assertMigrationContract(
  sql: postgres.Sql,
  seeded: { auditIds: number[]; jobIds: number[] },
  rowsBefore: Awaited<ReturnType<typeof readPreservedRows>>,
) {
  assert.deepEqual((await readPreservedRows(sql, seeded)).jobs, rowsBefore.jobs);
  assert.deepEqual((await readPreservedRows(sql, seeded)).audits, rowsBefore.audits);

  const actorKinds = await sql<{ actorKind: string; operatorId: number | null }[]>`
    SELECT actor_kind::text AS "actorKind", operator_id::int AS "operatorId"
    FROM operator_audit_log
    WHERE id = ANY(${seeded.auditIds}::bigint[])
    ORDER BY id
  `;
  assert.equal(actorKinds[0]?.actorKind, "operator");
  assert.notEqual(actorKinds[0]?.operatorId, null);
  assert.deepEqual(actorKinds[1], { actorKind: "legacy", operatorId: null });

  const jobRows = await sql`
    SELECT attempt_count, claim_token, lease_expires_at, heartbeat_at
    FROM import_jobs WHERE id = ANY(${seeded.jobIds}::bigint[]) ORDER BY id
  `;
  assert.deepEqual([...jobRows], [
    { attempt_count: 0, claim_token: null, lease_expires_at: null, heartbeat_at: null },
    { attempt_count: 0, claim_token: null, lease_expires_at: null, heartbeat_at: null },
  ]);

  const [role] = await sql<
    Array<{
      login: boolean;
      superuser: boolean;
      createDb: boolean;
      createRole: boolean;
      inherit: boolean;
      replication: boolean;
      bypassRls: boolean;
    }>
  >`
    SELECT rolcanlogin AS login, rolsuper AS superuser,
      rolcreatedb AS "createDb", rolcreaterole AS "createRole",
      rolinherit AS inherit, rolreplication AS replication,
      rolbypassrls AS "bypassRls"
    FROM pg_roles WHERE rolname = 'import_worker'
  `;
  assert.deepEqual(role, {
    login: false,
    superuser: false,
    createDb: false,
    createRole: false,
    inherit: false,
    replication: false,
    bypassRls: false,
  });

  const triggerCount = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM pg_trigger
    WHERE tgrelid = 'public.import_jobs'::regclass
      AND tgname = 'protect_terminal_import_job_update'
      AND NOT tgisinternal
  `;
  assert.equal(triggerCount[0]?.count, 1);
}

async function assertWorkerStateConstraints(sql: postgres.Sql) {
  await assertCheckViolation(
    sql`
      INSERT INTO import_jobs (
        source, status, mode, initiator_kind,
        total_rows, processed_count, imported_count, skipped_count, error_count,
        created_at, updated_at, attempt_count
      ) VALUES (
        'ising', 'queued', 'write', 'system',
        0, 0, 0, 0, 0, clock_timestamp(), clock_timestamp(), 1
      )
    `,
    "import_jobs_worker_claim_check",
  );
  await assertCheckViolation(
    sql`
      INSERT INTO import_jobs (
        source, status, mode, initiator_kind,
        total_rows, processed_count, imported_count, skipped_count, error_count,
        created_at, started_at, updated_at, attempt_count,
        claim_token, heartbeat_at, lease_expires_at
      ) VALUES (
        'ising', 'running', 'write', 'system',
        0, 0, 0, 0, 0,
        '2026-07-16T12:00:00Z', '2026-07-16T12:01:00Z',
        '2026-07-16T12:01:00Z', 1,
        ${firstToken}::uuid, '2026-07-16T12:00:30Z', '2026-07-16T12:02:00Z'
      )
    `,
    "import_jobs_worker_lease_check",
  );
}

async function assertPlatformServices(sql: postgres.Sql, operatorId: number) {
  await sql`DELETE FROM import_jobs`;
  const database = databaseFor(sql);
  const dependencies = platformDependencies(database, operatorId);
  const first = await enqueueImportJobWithDependencies(
    { source: "ising", mode: "write" },
    dependencies,
  );
  const second = await enqueueImportJobWithDependencies(
    { source: "karafun", mode: "validate" },
    dependencies,
  );
  assert.notEqual(first.id, second.id);
  await assert.rejects(
    enqueueImportJobWithDependencies(
      { source: "ising", mode: "write" },
      dependencies,
    ),
    (error: { code?: string }) => error.code === "IMPORT_JOB_ACTIVE",
  );

  const cancelled = await requestImportCancellationWithDependencies(
    { importJobId: first.id },
    dependencies,
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.changed, true);
  const repeated = await requestImportCancellationWithDependencies(
    { importJobId: first.id },
    dependencies,
  );
  assert.equal(repeated.changed, false);
  const audits = await sql<{ action: string; count: number }[]>`
    SELECT action, count(*)::int AS count
    FROM operator_audit_log
    WHERE entity_id = ${String(first.id)}
      AND action IN ('import.start', 'import.cancel')
    GROUP BY action ORDER BY action
  `;
  assert.deepEqual([...audits], [
    { action: "import.cancel", count: 1 },
    { action: "import.start", count: 1 },
  ]);
  await sql`DELETE FROM import_jobs`;
}

async function assertWorkerLifecycle(sql: postgres.Sql) {
  const database = databaseFor(sql);
  await insertQueuedJob(sql, "ising");
  const [singleClaimA, singleClaimB] = await Promise.all([
    claimWith(workerDependencies(database, () => firstToken)),
    claimWith(workerDependencies(database, () => secondToken)),
  ]);
  assert.equal([singleClaimA, singleClaimB].filter(Boolean).length, 1);
  assert.equal([singleClaimA, singleClaimB].filter((claim) => claim === null).length, 1);
  await sql`DELETE FROM import_jobs`;

  await insertQueuedJob(sql, "ising");
  await insertQueuedJob(sql, "karafun");
  const tokenQueue = [firstToken, secondToken];
  const dependencies = workerDependencies(database, () => tokenQueue.shift() ?? thirdToken);
  const [first, second] = await Promise.all([
    claimWith(dependencies),
    claimWith(dependencies),
  ]);
  assert.ok(first && second);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.source, second.source);

  await heartbeatImportJob(
    { importJobId: first.id, claimToken: first.claimToken },
    dependencies,
  );
  await updateImportJobProgress(
    {
      importJobId: first.id,
      claimToken: first.claimToken,
      totalCount: 2,
      processedCount: 1,
      importedCount: 1,
      skippedCount: 0,
      errorCount: 0,
    },
    dependencies,
  );
  await assert.rejects(
    updateImportJobProgress(
      {
        importJobId: first.id,
        claimToken: first.claimToken,
        totalCount: 1,
        processedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      },
      dependencies,
    ),
    (error: { code?: string }) => error.code === "IMPORT_JOB_PROGRESS_REGRESSION",
  );
  await assert.rejects(
    completeImportJob(
      {
        importJobId: first.id,
        claimToken: first.claimToken,
        totalCount: 0,
        processedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      },
      dependencies,
    ),
    (error: { code?: string }) => error.code === "INVALID_IMPORT_JOB_PROGRESS",
  );
  assert.equal(
    await completeImportJob(
      {
        importJobId: first.id,
        claimToken: first.claimToken,
        totalCount: 2,
        processedCount: 2,
        importedCount: 1,
        skippedCount: 1,
        errorCount: 0,
      },
      dependencies,
    ),
    "succeeded",
  );
  await failImportJob(
    {
      importJobId: second.id,
      claimToken: second.claimToken,
      safeErrorCode: "IMPORT_FAILED",
      safeErrorSummary: "The import failed safely.",
    },
    dependencies,
  );
  const terminal = await sql<{ status: string; claimToken: string | null }[]>`
    SELECT status::text AS status, claim_token::text AS "claimToken"
    FROM import_jobs WHERE id IN (${first.id}, ${second.id}) ORDER BY id
  `;
  assert.deepEqual(
    terminal.map(({ status, claimToken }) => ({ status, claimToken })).sort((a, b) => a.status.localeCompare(b.status)),
    [
      { status: "failed", claimToken: null },
      { status: "succeeded", claimToken: null },
    ],
  );
  await sql`DELETE FROM import_jobs`;
}

async function assertDeterministicClaimCancelRace(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  databaseName: string,
  operatorId: number,
) {
  const seedSql = createPostgresTestClient(harness, databaseName, 1);
  const [queued] = await insertQueuedJob(seedSql, "ising");
  assert.ok(queued);
  const seedDb = databaseFor(seedSql);
  const claim = await claimWith(workerDependencies(seedDb, () => firstToken));
  assert.ok(claim);
  await seedSql.end({ timeout: 5 });

  const blocker = createPostgresTestClient(harness, databaseName, 1);
  const mutation = createPostgresTestClient(harness, databaseName, 1);
  const observer = createPostgresTestClient(harness, databaseName, 1);
  let blockerOpen = false;
  try {
    await blocker.unsafe("BEGIN");
    blockerOpen = true;
    const [blockerSession] = await blocker<{ pid: number }[]>`
      SELECT pg_backend_pid() AS pid
    `;
    assert.ok(blockerSession);
    await blocker`SELECT id FROM import_jobs WHERE id = ${claim.id} FOR UPDATE`;

    const cancellation = requestImportCancellationWithDependencies(
      { importJobId: claim.id },
      platformDependencies(databaseFor(mutation), operatorId),
    );
    await waitUntilBlocked(observer, databaseName, blockerSession.pid);
    await blocker.unsafe("COMMIT");
    blockerOpen = false;
    const result = await cancellation;
    assert.equal(result.changed, true);

    const worker = workerDependencies(databaseFor(mutation), () => secondToken);
    assert.equal(
      await completeImportJob(
        {
          importJobId: claim.id,
          claimToken: claim.claimToken,
          totalCount: 0,
          processedCount: 0,
          importedCount: 0,
          skippedCount: 0,
          errorCount: 0,
        },
        worker,
      ),
      "cancelled",
    );
    const completionAudits = await observer<{ count: number }[]>`
      SELECT count(*)::int AS count FROM operator_audit_log
      WHERE entity_id = ${String(claim.id)} AND action = 'import.complete'
    `;
    assert.equal(completionAudits[0]?.count, 0);
  } finally {
    if (blockerOpen) await blocker.unsafe("ROLLBACK").catch(() => undefined);
    await blocker.end({ timeout: 5 });
    await mutation.end({ timeout: 5 });
    await observer`DELETE FROM import_jobs`;
    await observer.end({ timeout: 5 });
  }
}

async function assertStaleClaimAndRecovery(sql: postgres.Sql) {
  const database = databaseFor(sql);
  const workerOne = workerDependencies(database, () => firstToken);
  const workerTwo = workerDependencies(database, () => secondToken);
  await insertQueuedJob(sql, "ising");
  const first = await claimWith(workerOne);
  assert.ok(first);
  await sql`
    UPDATE import_jobs
    SET lease_expires_at = started_at,
        heartbeat_at = started_at
    WHERE id = ${first.id}
  `;
  const reclaimed = await claimWith(workerTwo);
  assert.ok(reclaimed);
  assert.equal(reclaimed.id, first.id);
  assert.equal(reclaimed.attemptCount, 2);
  await assert.rejects(
    heartbeatImportJob(
      { importJobId: first.id, claimToken: first.claimToken },
      workerOne,
    ),
    (error: { code?: string }) => error.code === "IMPORT_JOB_CLAIM_LOST",
  );

  await sql`
    UPDATE import_jobs
    SET attempt_count = 3,
        lease_expires_at = started_at,
        heartbeat_at = started_at
    WHERE id = ${first.id}
  `;
  assert.equal(await recoverExpiredImportJobs(workerTwo), 1);
  const [recovered] = await sql<
    Array<{ status: string; code: string; claimToken: string | null }>
  >`
    SELECT status::text AS status, safe_error_code AS code,
      claim_token::text AS "claimToken"
    FROM import_jobs WHERE id = ${first.id}
  `;
  assert.deepEqual(recovered, {
    status: "failed",
    code: "IMPORT_ATTEMPTS_EXHAUSTED",
    claimToken: null,
  });
  await sql`DELETE FROM import_jobs`;
}

async function assertAuditRollback(sql: postgres.Sql) {
  const database = databaseFor(sql);
  await insertQueuedJob(sql, "ising");
  const claim = await claimWith(workerDependencies(database, () => firstToken));
  assert.ok(claim);
  const failingDependencies = workerDependencies(database, () => secondToken, true);
  await assert.rejects(
    completeImportJob(
      {
        importJobId: claim.id,
        claimToken: claim.claimToken,
        totalCount: 0,
        processedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      },
      failingDependencies,
    ),
    (error: { code?: string }) => error.code === "PLATFORM_AUDIT_FAILED",
  );
  const [job] = await sql<{ status: string; token: string }[]>`
    SELECT status::text AS status, claim_token::text AS token
    FROM import_jobs WHERE id = ${claim.id}
  `;
  assert.deepEqual(job, { status: "running", token: claim.claimToken });
  await sql`DELETE FROM import_jobs`;
}

async function assertTerminalImmutability(sql: postgres.Sql) {
  const [job] = await sql<{ id: number }[]>`
    INSERT INTO import_jobs (
      source, status, mode, initiator_kind,
      total_rows, processed_count, imported_count, skipped_count, error_count,
      safe_error_code, safe_error_summary,
      created_at, started_at, finished_at, updated_at, attempt_count
    ) VALUES (
      'ising', 'failed', 'write', 'system',
      0, 0, 0, 0, 0, 'IMPORT_FAILED', 'The import failed safely.',
      '2026-07-16T13:00:00Z', '2026-07-16T13:01:00Z',
      '2026-07-16T13:02:00Z', '2026-07-16T13:03:00Z', 1
    ) RETURNING id::int AS id
  `;
  assert.ok(job);
  for (const statement of [
    sql`UPDATE import_jobs SET status = 'running' WHERE id = ${job.id}`,
    sql`UPDATE import_jobs SET status = 'cancelled' WHERE id = ${job.id}`,
    sql`UPDATE import_jobs SET total_rows = total_rows + 1 WHERE id = ${job.id}`,
    sql`UPDATE import_jobs SET safe_error_summary = 'Changed safely.' WHERE id = ${job.id}`,
    sql`UPDATE import_jobs SET initiator_kind = 'legacy' WHERE id = ${job.id}`,
    sql`UPDATE import_jobs SET updated_at = updated_at + interval '1 second' WHERE id = ${job.id}`,
  ]) {
    await assert.rejects(
      statement,
      (error: PgFailure) =>
        error.code === "23514" &&
        error.constraint_name === "import_jobs_terminal_immutable",
    );
  }
  await sql`DELETE FROM import_jobs WHERE id = ${job.id}`;

  const [requester] = await sql<{ id: number }[]>`
    INSERT INTO operator_users (name, password_hash)
    VALUES ('Cancellation Requester', 'not-used-by-test')
    RETURNING id::int AS id
  `;
  assert.ok(requester);
  const [cancelledJob] = await sql<{ id: number }[]>`
    INSERT INTO import_jobs (
      source, status, mode, initiator_kind,
      total_rows, processed_count, imported_count, skipped_count, error_count,
      created_at, started_at, updated_at, attempt_count,
      claim_token, heartbeat_at, lease_expires_at
    ) VALUES (
      'ising', 'running', 'write', 'system',
      0, 0, 0, 0, 0,
      '2026-07-16T14:00:00Z', '2026-07-16T14:01:00Z',
      '2026-07-16T14:01:00Z', 1,
      ${firstToken}::uuid, '2026-07-16T14:01:00Z',
      '2026-07-16T14:06:00Z'
    ) RETURNING id::int AS id
  `;
  assert.ok(cancelledJob);
  await sql`
    UPDATE import_jobs
    SET cancellation_requested_at = '2026-07-16T14:02:00Z',
        cancellation_requested_by_operator_id = ${requester.id}
    WHERE id = ${cancelledJob.id}
  `;
  await sql`
    UPDATE import_jobs
    SET status = 'cancelled',
        finished_at = '2026-07-16T14:03:00Z',
        updated_at = '2026-07-16T14:03:00Z',
        claim_token = NULL,
        heartbeat_at = NULL,
        lease_expires_at = NULL
    WHERE id = ${cancelledJob.id}
  `;
  const [beforeRequesterDelete] = await sql<
    Array<{ unchanged: Record<string, unknown> }>
  >`
    SELECT to_jsonb(job) - 'cancellation_requested_by_operator_id' AS unchanged
    FROM import_jobs job
    WHERE id = ${cancelledJob.id}
  `;
  assert.ok(beforeRequesterDelete);
  await sql`DELETE FROM operator_users WHERE id = ${requester.id}`;
  const [afterRequesterDelete] = await sql<
    Array<{
      requesterId: number | null;
      unchanged: Record<string, unknown>;
    }>
  >`
    SELECT cancellation_requested_by_operator_id::int AS "requesterId",
      to_jsonb(job) - 'cancellation_requested_by_operator_id' AS unchanged
    FROM import_jobs job
    WHERE id = ${cancelledJob.id}
  `;
  assert.deepEqual(afterRequesterDelete, {
    requesterId: null,
    unchanged: beforeRequesterDelete.unchanged,
  });
  await assert.rejects(
    sql`
      UPDATE import_jobs
      SET updated_at = updated_at + interval '1 second'
      WHERE id = ${cancelledJob.id}
    `,
    (error: PgFailure) =>
      error.code === "23514" &&
      error.constraint_name === "import_jobs_terminal_immutable",
  );
  await sql`DELETE FROM import_jobs WHERE id = ${cancelledJob.id}`;
}

async function assertWorkerPrivileges(
  harness: Awaited<ReturnType<typeof startPostgresTestHarness>>,
  databaseName: string,
  sql: postgres.Sql,
  operatorId: number,
) {
  const [job] = await insertQueuedJob(sql, "ising");
  assert.ok(job);
  const roleClient = createPostgresTestClient(harness, databaseName, 1);
  try {
    await roleClient.unsafe("SET ROLE import_worker");
    const [identity] = await roleClient<{ currentUser: string }[]>`
      SELECT current_user::text AS "currentUser"
    `;
    assert.equal(identity?.currentUser, "import_worker");
    const roleWorker = workerDependencies(
      databaseFor(roleClient),
      () => firstToken,
    );
    const claim = await claimWith(roleWorker);
    assert.ok(claim);
    assert.equal(claim.id, job.id);
    assert.equal(
      await completeImportJob(
        {
          importJobId: claim.id,
          claimToken: claim.claimToken,
          totalCount: 0,
          processedCount: 0,
          importedCount: 0,
          skippedCount: 0,
          errorCount: 0,
        },
        roleWorker,
      ),
      "succeeded",
    );
  } finally {
    await roleClient.end({ timeout: 5 });
  }

  const [activeJob] = await insertQueuedJob(sql, "ising");
  assert.ok(activeJob);
  await sql.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL ROLE import_worker");
    const visible = await transaction<{ id: number }[]>`
      SELECT id::int AS id FROM import_jobs WHERE id = ${activeJob.id}
    `;
    assert.equal(visible.length, 1);
    await transaction`
      INSERT INTO operator_audit_log (
        actor_kind, operator_id, action, entity_id, payload
      ) VALUES (
        'system', NULL, 'import.fail', ${String(activeJob.id)},
        '{"schemaVersion":1,"targetType":"import_job","outcome":"failure","summary":"Safe failure."}'::jsonb
      )
    `;
  });

  for (const statement of [
    "DELETE FROM public.import_jobs",
    "TRUNCATE public.import_jobs",
    "CREATE TABLE public.worker_escape(id integer)",
    "SELECT id FROM public.platform_members",
    "SELECT id FROM public.operator_sessions",
  ]) {
    await assert.rejects(
      sql.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL ROLE import_worker");
        await transaction.unsafe(statement);
      }),
      (error: PgFailure) => error.code === "42501",
    );
  }
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(
      sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL ROLE ${role}`);
        await transaction`SELECT id FROM import_jobs WHERE id = ${activeJob.id}`;
      }),
      (error: PgFailure) => error.code === "42501",
    );
  }
  const operatorAudit = await sql<{ actorKind: string; operatorId: number }[]>`
    SELECT actor_kind::text AS "actorKind", operator_id::int AS "operatorId"
    FROM operator_audit_log
    WHERE operator_id = ${operatorId} AND actor_kind = 'operator'
    LIMIT 1
  `;
  assert.equal(operatorAudit.length > 0, true);
  await sql`DELETE FROM import_jobs`;
}

function databaseFor(sql: postgres.Sql) {
  return drizzle({ client: sql, schema });
}

function platformDependencies(
  database: Database,
  operatorId: number,
): ImportJobMutationDependencies {
  return {
    authorizeActor: async () => ({ operatorId }),
    runTransaction: (callback) =>
      database.transaction((transaction) =>
        callback(createImportJobTransactionStore(transaction)),
      ),
    waitBeforeRetry: async () => undefined,
    retryDelayMilliseconds: () => 0,
  };
}

function workerDependencies(
  database: Database,
  randomClaimToken: () => string,
  failAudit = false,
): ImportWorkerDependencies {
  return {
    runTransaction: (callback) =>
      database.transaction((transaction) => {
        const store = createImportWorkerTransactionStore(transaction);
        return callback(
          failAudit
            ? {
                ...store,
                insertAuditRecord: async () => {
                  throw new Error("audit unavailable");
                },
              }
            : store,
        );
      }),
    randomClaimToken,
    waitBeforeRetry: async () => undefined,
    retryDelayMilliseconds: () => 0,
  };
}

function claimWith(dependencies: ImportWorkerDependencies) {
  return import("../../src/server/platform-admin/import-worker-core.ts").then(
    ({ claimNextImportJob }) => claimNextImportJob(dependencies),
  );
}

function insertQueuedJob(sql: postgres.Sql, source: "ising" | "karafun") {
  return sql<{ id: number }[]>`
    INSERT INTO import_jobs (
      source, status, mode, initiator_kind,
      total_rows, processed_count, imported_count, skipped_count, error_count,
      created_at, updated_at, attempt_count
    ) VALUES (
      ${source}::import_source, 'queued', 'write', 'system',
      0, 0, 0, 0, 0, clock_timestamp(), clock_timestamp(), 0
    ) RETURNING id::int AS id
  `;
}

async function waitUntilBlocked(
  observer: postgres.Sql,
  databaseName: string,
  blockerPid: number,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [row] = await observer<{ blocked: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = ${databaseName}
          AND ${blockerPid} = ANY(pg_blocking_pids(pid))
      ) AS blocked
    `;
    if (row?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the import cancellation lock.");
}

async function assertCheckViolation(
  operation: Promise<unknown>,
  constraintName: string,
) {
  await assert.rejects(
    operation,
    (error: PgFailure) =>
      error.code === "23514" && error.constraint_name === constraintName,
  );
}

async function objectExists(sql: postgres.Sql, name: string) {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT to_regtype(${name}) IS NOT NULL AS exists
  `;
  return row?.exists === true;
}
