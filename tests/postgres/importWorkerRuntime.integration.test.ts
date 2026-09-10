import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  classifyISingImportFailure,
  createISingSongBatchWriter,
  runISingImportAdapter,
} from "../../src/db/ising-import-adapter.ts";
import * as schema from "../../src/db/schema.ts";
import { createImportWorkerServices } from "../../src/server/platform-admin/import-worker.ts";
import {
  assertImportWorkerIdentity,
  createImportWorkerConnection,
  runImportWorkerProcess,
} from "../../src/server/platform-admin/import-worker-process.ts";
import {
  runImportWorkerCycle,
  type ImportWorkerRuntimeDependencies,
  type ImportWorkerRuntimeServices,
} from "../../src/server/platform-admin/import-worker-runtime-core.ts";
import {
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

const images = ["postgres:15-alpine", "postgres:17-alpine"] as const;

test(
  "the iSing worker runtime executes durable jobs on PostgreSQL 15 and 17",
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
    `pozanuta-import-worker-runtime-pg${version}`,
    image,
  );
  const admin = createPostgresTestClient(harness, "postgres");
  const databaseName = postgresDatabaseName(`import_worker_runtime_pg${version}`);

  try {
    await createPostgresDatabase(admin, databaseName);
    const sql = createPostgresTestClient(harness, databaseName, 4);
    try {
      await installPostgresCompatibilityFixture(sql);
      await applyPostgresMigrations(sql, 19);

      await assertDedicatedLoginReconnect(harness, databaseName, sql);
      await assertServerSideDefaultRoleReconnect(harness, databaseName, sql);
      await assertProcessPreflight(harness, databaseName, sql);
      await assertIdentityContractIsFailClosed(harness, databaseName, sql);
      await assertWriteLifecycle(harness, databaseName, sql);
      await assertReadOnlyModes(harness, databaseName, sql);
      await assertCooperativeCancellation(harness, databaseName, sql);
      await assertSingleClaimAcrossWorkers(harness, databaseName, sql);
      await assertClaimLostCannotWrite(harness, databaseName, sql);
      await assertTransientRetryAndExhaustion(harness, databaseName, sql);
      await assertInfrastructureFailureRecovery(harness, databaseName, sql);
      await assertSafeTerminalFailure(harness, databaseName, sql);
      await assertSyntheticCrossSourceClaims(harness, databaseName, sql);
      await assertRuntimePrivileges(harness, databaseName, sql);
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

async function assertDedicatedLoginReconnect(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const login = await createDedicatedWorkerLogin(harness, databaseName, admin);
  const worker = createImportWorkerConnection(login.databaseUrl);
  try {
    await assertImportWorkerIdentity(worker);
    const [firstSession] = await worker<
      Array<{
        backendPid: number;
        expectedSessionUser: boolean;
        expectedCurrentUser: boolean;
      }>
    >`
      SELECT
        pg_backend_pid() AS "backendPid",
        session_user = ${login.name} AS "expectedSessionUser",
        current_user = 'import_worker' AS "expectedCurrentUser"
    `;
    assert.ok(firstSession?.expectedSessionUser);
    assert.ok(firstSession.expectedCurrentUser);

    const [termination] = await admin<{ terminated: boolean }[]>`
      SELECT pg_terminate_backend(${firstSession.backendPid}) AS terminated
    `;
    assert.equal(termination?.terminated, true);

    await waitForWorkerReconnect(worker);
    const [secondSession] = await worker<
      Array<{
        backendPid: number;
        expectedSessionUser: boolean;
        expectedCurrentUser: boolean;
      }>
    >`
      SELECT
        pg_backend_pid() AS "backendPid",
        session_user = ${login.name} AS "expectedSessionUser",
        current_user = 'import_worker' AS "expectedCurrentUser"
    `;
    assert.ok(secondSession?.expectedSessionUser);
    assert.ok(secondSession.expectedCurrentUser);
    assert.notEqual(secondSession.backendPid, firstSession.backendPid);
  } finally {
    await worker.end({ timeout: 5 });
    await dropDedicatedWorkerLogin(admin, login.name);
  }
}

async function assertServerSideDefaultRoleReconnect(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const jobId = await insertQueuedJob(admin, "ising", "write");
  const [evidenceBefore] = await admin<
    Array<{ diagnostics: number; audits: number }>
  >`
    SELECT
      (SELECT count(*)::int FROM import_job_diagnostics) AS diagnostics,
      (SELECT count(*)::int FROM operator_audit_log) AS audits
  `;
  const login = await createDedicatedWorkerLogin(harness, databaseName, admin);
  assert.match(databaseName, /^[a-z0-9_]+$/);
  const roleSetting = `ALTER ROLE "${login.name}" IN DATABASE "${databaseName}"`;
  let worker: postgres.Sql | undefined;

  try {
    await admin.unsafe(`${roleSetting} SET role TO import_worker`);
    worker = postgres(login.databaseUrl, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 0,
      prepare: false,
    });

    await assertImportWorkerIdentity(worker);
    const [firstSession] = await worker<
      Array<{
        backendPid: number;
        expectedSessionUser: boolean;
        expectedCurrentUser: boolean;
        exactRoleSetting: boolean;
      }>
    >`
      SELECT
        pg_backend_pid() AS "backendPid",
        session_user = ${login.name} AS "expectedSessionUser",
        current_user = 'import_worker' AS "expectedCurrentUser",
        (
          SELECT count(*) = 1
            AND bool_and(setting = 'role=import_worker')
          FROM pg_catalog.pg_db_role_setting AS role_setting
          CROSS JOIN LATERAL unnest(role_setting.setconfig) AS setting
          WHERE role_setting.setrole = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ${login.name}
          )
            AND role_setting.setdatabase = (
              SELECT oid FROM pg_catalog.pg_database
              WHERE datname = current_database()
            )
        ) AS "exactRoleSetting"
    `;
    assert.ok(firstSession?.expectedSessionUser);
    assert.ok(firstSession.expectedCurrentUser);
    assert.ok(firstSession.exactRoleSetting);

    await worker`RESET ROLE`;
    await assertImportWorkerIdentity(worker);
    const [afterReset] = await worker<
      Array<{ expectedCurrentUser: boolean }>
    >`
      SELECT current_user = 'import_worker' AS "expectedCurrentUser"
    `;
    assert.ok(afterReset?.expectedCurrentUser);

    const [termination] = await admin<{ terminated: boolean }[]>`
      SELECT pg_terminate_backend(${firstSession.backendPid}) AS terminated
    `;
    assert.equal(termination?.terminated, true);

    await waitForWorkerReconnect(worker);
    const [secondSession] = await worker<
      Array<{
        backendPid: number;
        expectedSessionUser: boolean;
        expectedCurrentUser: boolean;
      }>
    >`
      SELECT
        pg_backend_pid() AS "backendPid",
        session_user = ${login.name} AS "expectedSessionUser",
        current_user = 'import_worker' AS "expectedCurrentUser"
    `;
    assert.ok(secondSession?.expectedSessionUser);
    assert.ok(secondSession.expectedCurrentUser);
    assert.notEqual(secondSession.backendPid, firstSession.backendPid);
    await assertQueuedJobRemainsUntouched(admin, jobId);
    const [evidenceAfter] = await admin<
      Array<{ diagnostics: number; audits: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM import_job_diagnostics) AS diagnostics,
        (SELECT count(*)::int FROM operator_audit_log) AS audits
    `;
    assert.deepEqual(evidenceAfter, evidenceBefore);
  } finally {
    if (worker) await worker.end({ timeout: 5 });
    try {
      await admin.unsafe(`${roleSetting} RESET role`);
    } finally {
      try {
        await admin.unsafe(`REVOKE import_worker FROM "${login.name}"`);
      } finally {
        await dropDedicatedWorkerLogin(admin, login.name);
        await admin`DELETE FROM import_jobs WHERE id = ${jobId}`;
      }
    }
  }
}

async function assertProcessPreflight(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const jobId = await insertQueuedJob(admin, "ising", "write");
  const login = await createDedicatedWorkerLogin(harness, databaseName, admin);
  try {
    await assert.rejects(
      runImportWorkerProcess(
        {
          NODE_ENV: "test",
          IMPORT_WORKER_DATABASE_URL: login.databaseUrl,
        },
        ["--once"],
      ),
      /ISING_CLIENT_ID is not configured/,
    );
    await assertQueuedJobRemainsUntouched(admin, jobId);

    await assert.rejects(
      runImportWorkerProcess(
        {
          NODE_ENV: "test",
          IMPORT_WORKER_DATABASE_URL: postgresTestUrl(
            harness,
            databaseName,
            "postgres",
            harness.password,
          ),
          ISING_CLIENT_ID: "test-client",
        },
        ["--once"],
      ),
      /import worker database role is invalid/i,
    );
    await assertQueuedJobRemainsUntouched(admin, jobId);
  } finally {
    await dropDedicatedWorkerLogin(admin, login.name);
    await admin`DELETE FROM import_jobs WHERE id = ${jobId}`;
  }
}

async function assertIdentityContractIsFailClosed(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  await assertRejectedIdentityLeavesQueuedJobUntouched(
    harness,
    databaseName,
    admin,
    async (loginName) => {
      await admin.unsafe(`ALTER ROLE "${loginName}" INHERIT`);
    },
    async (loginName) => {
      await admin.unsafe(`ALTER ROLE "${loginName}" NOINHERIT`);
    },
  );

  const additionalRole = temporaryRoleName("worker_extra");
  await assertRejectedIdentityLeavesQueuedJobUntouched(
    harness,
    databaseName,
    admin,
    async (loginName) => {
      await admin.unsafe(`
        CREATE ROLE "${additionalRole}"
        NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOINHERIT NOREPLICATION NOBYPASSRLS
      `);
      await admin.unsafe(`GRANT "${additionalRole}" TO "${loginName}"`);
    },
    async (loginName) => {
      await admin.unsafe(`REVOKE "${additionalRole}" FROM "${loginName}"`);
      await admin.unsafe(`DROP ROLE "${additionalRole}"`);
    },
  );

  await assertRejectedIdentityLeavesQueuedJobUntouched(
    harness,
    databaseName,
    admin,
    async (loginName) => {
      await admin.unsafe(
        `GRANT import_worker TO "${loginName}" WITH ADMIN OPTION`,
      );
    },
    async (loginName) => {
      await admin.unsafe(
        `REVOKE ADMIN OPTION FOR import_worker FROM "${loginName}"`,
      );
    },
  );

  await assertRejectedIdentityLeavesQueuedJobUntouched(
    harness,
    databaseName,
    admin,
    async () => {
      await admin`ALTER ROLE import_worker BYPASSRLS`;
    },
    async () => {
      await admin`ALTER ROLE import_worker NOBYPASSRLS`;
    },
  );
}

async function assertRejectedIdentityLeavesQueuedJobUntouched(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
  makeUnsafe: (loginName: string) => Promise<void>,
  restore: (loginName: string) => Promise<void>,
) {
  const jobId = await insertQueuedJob(admin, "ising", "write");
  const login = await createDedicatedWorkerLogin(harness, databaseName, admin);
  try {
    await makeUnsafe(login.name);
    await assert.rejects(
      runImportWorkerProcess(
        {
          NODE_ENV: "test",
          IMPORT_WORKER_DATABASE_URL: login.databaseUrl,
          ISING_CLIENT_ID: "test-client",
        },
        ["--once"],
      ),
      /import worker database role is invalid/i,
    );
    await assertQueuedJobRemainsUntouched(admin, jobId);
  } finally {
    try {
      await restore(login.name);
    } finally {
      await dropDedicatedWorkerLogin(admin, login.name);
      await admin`DELETE FROM import_jobs WHERE id = ${jobId}`;
    }
  }
}

async function assertWriteLifecycle(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const jobId = await insertQueuedJob(admin, "ising", "write");
  const worker = await workerContext(harness, databaseName, admin, [
    song(101),
    song(102),
  ]);
  try {
    assert.equal(await runImportWorkerCycle(worker.dependencies), "succeeded");
    const [job] = await admin<
      Array<{
        status: string;
        total: number;
        processed: number;
        imported: number;
        skipped: number;
        errors: number;
        timestampsValid: boolean;
        claimToken: string | null;
      }>
    >`
      SELECT status::text AS status, total_rows AS total,
        processed_count AS processed, imported_count AS imported,
        skipped_count AS skipped, error_count AS errors,
        created_at <= started_at
          AND started_at <= finished_at
          AND finished_at <= updated_at AS "timestampsValid",
        claim_token::text AS "claimToken"
      FROM import_jobs WHERE id = ${jobId}
    `;
    assert.deepEqual(job, {
      status: "succeeded",
      total: 2,
      processed: 2,
      imported: 2,
      skipped: 0,
      errors: 0,
      timestampsValid: true,
      claimToken: null,
    });
    const [evidence] = await admin<
      Array<{ songs: number; completeAudits: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM songs WHERE source = 'ising') AS songs,
        (SELECT count(*)::int FROM operator_audit_log
          WHERE entity_id = ${String(jobId)} AND action = 'import.complete')
          AS "completeAudits"
    `;
    assert.deepEqual(evidence, { songs: 2, completeAudits: 1 });
  } finally {
    await worker.close();
  }
}

async function assertReadOnlyModes(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const before = await songCount(admin);
  for (const mode of ["dry_run", "validate"] as const) {
    const jobId = await insertQueuedJob(admin, "ising", mode);
    const worker = await workerContext(harness, databaseName, admin, [song(200)]);
    try {
      assert.equal(await runImportWorkerCycle(worker.dependencies), "succeeded");
    } finally {
      await worker.close();
    }
    const [job] = await admin<{ status: string; processed: number }[]>`
      SELECT status::text AS status, processed_count AS processed
      FROM import_jobs WHERE id = ${jobId}
    `;
    assert.deepEqual(job, { status: "succeeded", processed: 1 });
    assert.equal(await songCount(admin), before);
  }
}

async function assertCooperativeCancellation(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const before = await songCount(admin);
  const jobId = await insertQueuedJob(admin, "ising", "write");
  const worker = await workerContext(
    harness,
    databaseName,
    admin,
    [song(301), song(302)],
    1,
  );
  let progressWrites = 0;
  const updateProgress = worker.dependencies.services.updateImportJobProgress;
  worker.dependencies.services.updateImportJobProgress = async (input) => {
    await updateProgress(input);
    progressWrites += 1;
    if (progressWrites === 1) {
      await admin`
        UPDATE import_jobs
        SET cancellation_requested_at = clock_timestamp()
        WHERE id = ${jobId}
      `;
    }
  };

  try {
    assert.equal(await runImportWorkerCycle(worker.dependencies), "cancelled");
    const [job] = await admin<
      Array<{ status: string; processed: number; completeAudits: number }>
    >`
      SELECT status::text AS status, processed_count AS processed,
        (SELECT count(*)::int FROM operator_audit_log
          WHERE entity_id = ${String(jobId)} AND action = 'import.complete')
          AS "completeAudits"
      FROM import_jobs WHERE id = ${jobId}
    `;
    assert.deepEqual(job, {
      status: "cancelled",
      processed: 1,
      completeAudits: 0,
    });
    assert.equal(await songCount(admin), before + 1);
  } finally {
    await worker.close();
  }
}

async function assertSingleClaimAcrossWorkers(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  await insertQueuedJob(admin, "ising", "write");
  const first = await workerContext(harness, databaseName, admin, [song(401)]);
  const second = await workerContext(harness, databaseName, admin, [song(402)]);
  try {
    const outcomes = await Promise.all([
      runImportWorkerCycle(first.dependencies),
      runImportWorkerCycle(second.dependencies),
    ]);
    assert.deepEqual([...outcomes].sort(), ["idle", "succeeded"]);
  } finally {
    await first.close();
    await second.close();
  }
}

async function assertTransientRetryAndExhaustion(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const retryJobId = await insertQueuedJob(admin, "ising", "write");
  const transient = await workerContext(harness, databaseName, admin, [], 10, true);
  try {
    assert.equal(
      await runImportWorkerCycle(transient.dependencies),
      "retry_pending",
    );
  } finally {
    await transient.close();
  }
  await expireLease(admin, retryJobId);

  const recovered = await workerContext(harness, databaseName, admin, [song(501)]);
  try {
    assert.equal(await runImportWorkerCycle(recovered.dependencies), "succeeded");
  } finally {
    await recovered.close();
  }
  const [sameJob] = await admin<{ id: number; attempts: number; status: string }[]>`
    SELECT id::int AS id, attempt_count AS attempts, status::text AS status
    FROM import_jobs WHERE id = ${retryJobId}
  `;
  assert.deepEqual(sameJob, { id: retryJobId, attempts: 2, status: "succeeded" });

  const exhaustedJobId = await insertQueuedJob(admin, "ising", "write");
  const exhausted = await workerContext(harness, databaseName, admin, [], 10, true);
  try {
    assert.equal(
      await runImportWorkerCycle(exhausted.dependencies),
      "retry_pending",
    );
  } finally {
    await exhausted.close();
  }
  await admin`
    UPDATE import_jobs
    SET attempt_count = 3, lease_expires_at = started_at,
        heartbeat_at = started_at
    WHERE id = ${exhaustedJobId}
  `;
  const recovery = await workerContext(harness, databaseName, admin, []);
  try {
    assert.equal(await runImportWorkerCycle(recovery.dependencies), "idle");
  } finally {
    await recovery.close();
  }
  const [exhaustedEvidence] = await admin<
    Array<{ status: string; diagnostics: number; audits: number }>
  >`
    SELECT status::text AS status,
      (SELECT count(*)::int FROM import_job_diagnostics
        WHERE import_job_id = ${exhaustedJobId}) AS diagnostics,
      (SELECT count(*)::int FROM operator_audit_log
        WHERE entity_id = ${String(exhaustedJobId)} AND action = 'import.fail') AS audits
    FROM import_jobs WHERE id = ${exhaustedJobId}
  `;
  assert.deepEqual(exhaustedEvidence, {
    status: "failed",
    diagnostics: 1,
    audits: 1,
  });
}

async function assertInfrastructureFailureRecovery(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const jobId = await insertQueuedJob(admin, "ising", "write");
  const interrupted = await workerContext(
    harness,
    databaseName,
    admin,
    [song(550)],
    10,
    false,
    undefined,
    true,
  );
  try {
    assert.equal(
      await runImportWorkerCycle(interrupted.dependencies),
      "retry_pending",
    );
    assert.equal(interrupted.infrastructureCode(), "57014");
  } finally {
    await interrupted.close();
  }

  const [pendingEvidence] = await admin<
    Array<{
      id: number;
      status: string;
      attempts: number;
      safeErrorCode: string | null;
      safeErrorSummary: string | null;
      diagnostics: number;
      failureAudits: number;
    }>
  >`
    SELECT id::int AS id, status::text AS status,
      attempt_count AS attempts,
      safe_error_code AS "safeErrorCode",
      safe_error_summary AS "safeErrorSummary",
      (SELECT count(*)::int FROM import_job_diagnostics
        WHERE import_job_id = import_jobs.id) AS diagnostics,
      (SELECT count(*)::int FROM operator_audit_log
        WHERE entity_id = import_jobs.id::text AND action = 'import.fail')
        AS "failureAudits"
    FROM import_jobs
    WHERE id = ${jobId}
  `;
  assert.deepEqual(pendingEvidence, {
    id: jobId,
    status: "running",
    attempts: 1,
    safeErrorCode: null,
    safeErrorSummary: null,
    diagnostics: 0,
    failureAudits: 0,
  });

  await expireLease(admin, jobId);
  const recovered = await workerContext(harness, databaseName, admin, [song(550)]);
  try {
    assert.equal(await runImportWorkerCycle(recovered.dependencies), "succeeded");
  } finally {
    await recovered.close();
  }

  const [finalEvidence] = await admin<
    Array<{ id: number; status: string; attempts: number; failureAudits: number }>
  >`
    SELECT id::int AS id, status::text AS status, attempt_count AS attempts,
      (SELECT count(*)::int FROM operator_audit_log
        WHERE entity_id = import_jobs.id::text AND action = 'import.fail')
        AS "failureAudits"
    FROM import_jobs
    WHERE id = ${jobId}
  `;
  assert.deepEqual(finalEvidence, {
    id: jobId,
    status: "succeeded",
    attempts: 2,
    failureAudits: 0,
  });
}

async function assertClaimLostCannotWrite(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const jobId = await insertQueuedJob(admin, "ising", "write");
  const first = await workerContext(harness, databaseName, admin, []);
  const second = await workerContext(harness, databaseName, admin, []);
  try {
    const firstClaim = await first.allSourceClaim();
    assert.ok(firstClaim);
    await expireLease(admin, jobId);
    const secondClaim = await second.allSourceClaim();
    assert.ok(secondClaim);
    assert.equal(secondClaim.id, firstClaim.id);

    const before = await readMutableJobState(admin, jobId);
    await assert.rejects(
      first.dependencies.services.checkpointImportJob({
        importJobId: jobId,
        claimToken: firstClaim.claimToken,
      }),
      (error: { code?: string }) => error.code === "IMPORT_JOB_CLAIM_LOST",
    );
    await assert.rejects(
      first.dependencies.services.updateImportJobProgress({
        importJobId: jobId,
        claimToken: firstClaim.claimToken,
        totalCount: 1,
        processedCount: 1,
        importedCount: 1,
        skippedCount: 0,
        errorCount: 0,
      }),
      (error: { code?: string }) => error.code === "IMPORT_JOB_CLAIM_LOST",
    );
    assert.deepEqual(await readMutableJobState(admin, jobId), before);
  } finally {
    await first.close();
    await second.close();
    await admin`DELETE FROM import_jobs WHERE id = ${jobId}`;
  }
}

async function assertSafeTerminalFailure(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const jobId = await insertQueuedJob(admin, "ising", "write");
  const secret = "test-only-upstream-secret";
  const worker = await workerContext(
    harness,
    databaseName,
    admin,
    [],
    10,
    false,
    secret,
  );
  try {
    assert.equal(await runImportWorkerCycle(worker.dependencies), "failed");
  } finally {
    await worker.close();
  }
  const evidence = await admin`
    SELECT status::text, safe_error_code, safe_error_summary
    FROM import_jobs WHERE id = ${jobId}
    UNION ALL
    SELECT 'diagnostic', code, safe_summary
    FROM import_job_diagnostics WHERE import_job_id = ${jobId}
  `;
  assert.equal(JSON.stringify(evidence).includes(secret), false);
}

async function assertSyntheticCrossSourceClaims(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  await insertQueuedJob(admin, "ising", "write");
  await insertQueuedJob(admin, "karafun", "write");
  const first = await workerContext(harness, databaseName, admin, []);
  const second = await workerContext(harness, databaseName, admin, []);
  try {
    const [firstClaim, secondClaim] = await Promise.all([
      first.allSourceClaim(),
      second.allSourceClaim(),
    ]);
    assert.ok(firstClaim && secondClaim);
    assert.deepEqual(
      [firstClaim.source, secondClaim.source].sort(),
      ["ising", "karafun"],
    );
  } finally {
    await first.close();
    await second.close();
    await admin`DELETE FROM import_jobs WHERE status = 'running'`;
  }
}

async function assertRuntimePrivileges(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const login = await createDedicatedWorkerLogin(harness, databaseName, admin);
  const worker = createImportWorkerConnection(login.databaseUrl);
  try {
    await assertImportWorkerIdentity(worker);
    for (const statement of [
      "DELETE FROM public.songs",
      "TRUNCATE public.songs",
      "CREATE TABLE public.worker_escape(id integer)",
      "SELECT id FROM public.operator_users",
    ]) {
      await assert.rejects(
        worker.unsafe(statement),
        (error: { code?: string }) => error.code === "42501",
      );
    }
  } finally {
    await worker.end({ timeout: 5 });
    await dropDedicatedWorkerLogin(admin, login.name);
  }
  await admin`DELETE FROM import_jobs WHERE status = 'running'`;
}

async function workerContext(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
  songs: unknown[],
  batchSize = 10,
  transientFailure = false,
  terminalSecret?: string,
  infrastructureFailure = false,
) {
  const login = await createDedicatedWorkerLogin(harness, databaseName, admin);
  const client = createImportWorkerConnection(login.databaseUrl);
  await assertImportWorkerIdentity(client);
  const database = drizzle({ client, schema });
  const services = createImportWorkerServices(database);
  const persistBatch = createISingSongBatchWriter(database);
  let infrastructureCode: string | null = null;
  const runtimeServices: ImportWorkerRuntimeServices = {
    assertWorkerIdentity: async () => {
      await assertImportWorkerIdentity(client);
    },
    recoverExpiredImportJobs: () => services.recoverExpiredImportJobs(),
    claimNextImportJob: () => services.claimNextImportJob(["ising"]),
    checkpointImportJob: services.checkpointImportJob,
    updateImportJobProgress: services.updateImportJobProgress,
    completeImportJob: services.completeImportJob,
    failImportJob: services.failImportJob,
  };
  const dependencies: ImportWorkerRuntimeDependencies = {
    services: runtimeServices,
    executeISing: async ({ claim, checkpoint }) => {
      if (transientFailure) throw new TypeError("temporary network failure");
      if (terminalSecret) throw new Error(`invalid payload ${terminalSecret}`);
      const batchWriter = infrastructureFailure
        ? async () => {
            try {
              await client.begin(async (transaction) => {
                await transaction.unsafe(
                  "SET LOCAL statement_timeout = '25ms'",
                );
                await transaction.unsafe("SELECT pg_sleep(1)");
              });
            } catch (error) {
              infrastructureCode =
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                typeof error.code === "string"
                  ? error.code
                  : null;
              throw error;
            }
            throw new Error("The infrastructure timeout did not occur.");
          }
        : persistBatch;
      return runISingImportAdapter(
        {
          apiBaseUrl: "https://api.ising.pl/v2",
          clientId: "test-client",
          delayMs: 0,
          tag: "",
          order: "-artist_string",
          limit: null,
          mode: claim.mode,
          batchSize,
          timeoutMs: 1_000,
        },
        {
          fetchFn: async () => response(page(songs)),
          delayFn: async () => undefined,
          persistBatch: claim.mode === "write" ? batchWriter : undefined,
          checkpoint: ({ phase, progress }) => checkpoint(phase, progress),
        },
      );
    },
    classifyISingFailure: classifyISingImportFailure,
    isStopping: () => false,
    wait: async () => undefined,
    random: () => 0,
  };
  return {
    dependencies,
    allSourceClaim: () => services.claimNextImportJob(["ising", "karafun"]),
    infrastructureCode: () => infrastructureCode,
    close: async () => {
      await client.end({ timeout: 5 });
      await dropDedicatedWorkerLogin(admin, login.name);
    },
  };
}

async function createDedicatedWorkerLogin(
  harness: Harness,
  databaseName: string,
  admin: postgres.Sql,
) {
  const name = `worker_login_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const passwordBytes = randomBytes(32);
  const password = passwordBytes.toString("base64url");
  passwordBytes.fill(0);
  assert.match(name, /^[a-z0-9_]+$/);
  assert.match(password, /^[A-Za-z0-9_-]+$/);

  await admin.unsafe(`
    CREATE ROLE "${name}"
    LOGIN PASSWORD '${password}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  `);
  await admin.unsafe(`GRANT import_worker TO "${name}"`);

  return {
    name,
    databaseUrl: postgresTestUrl(
      harness,
      databaseName,
      name,
      password,
    ),
  };
}

function temporaryRoleName(prefix: string) {
  const name = `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  assert.match(name, /^[a-z0-9_]+$/);
  return name;
}

async function dropDedicatedWorkerLogin(admin: postgres.Sql, name: string) {
  assert.match(name, /^[a-z0-9_]+$/);
  await admin.unsafe(`DROP ROLE IF EXISTS "${name}"`);
}

function postgresTestUrl(
  harness: Harness,
  databaseName: string,
  user: string,
  password: string,
) {
  const url = new URL("postgresql://127.0.0.1");
  url.port = String(harness.port);
  url.pathname = `/${databaseName}`;
  url.username = user;
  url.password = password;
  return url.toString();
}

async function waitForWorkerReconnect(worker: postgres.Sql) {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertImportWorkerIdentity(worker);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error("The worker did not reconnect with its required role.", {
    cause: lastError,
  });
}

async function assertQueuedJobRemainsUntouched(
  admin: postgres.Sql,
  jobId: number,
) {
  const [job] = await admin<
    Array<{
      status: string;
      attempts: number;
      diagnostics: number;
      audits: number;
    }>
  >`
    SELECT status::text AS status, attempt_count AS attempts,
      (SELECT count(*)::int FROM import_job_diagnostics
        WHERE import_job_id = import_jobs.id) AS diagnostics,
      (SELECT count(*)::int FROM operator_audit_log
        WHERE entity_id = import_jobs.id::text
          AND action IN ('import.complete', 'import.fail')) AS audits
    FROM import_jobs
    WHERE id = ${jobId}
  `;
  assert.deepEqual(job, {
    status: "queued",
    attempts: 0,
    diagnostics: 0,
    audits: 0,
  });
}

async function insertQueuedJob(
  sql: postgres.Sql,
  source: "ising" | "karafun",
  mode: "validate" | "dry_run" | "write",
) {
  const [job] = await sql<{ id: number }[]>`
    INSERT INTO import_jobs (
      source, status, mode, initiator_kind,
      total_rows, processed_count, imported_count, skipped_count, error_count,
      created_at, updated_at, attempt_count
    ) VALUES (
      ${source}::import_source, 'queued', ${mode}::import_job_mode, 'system',
      0, 0, 0, 0, 0, clock_timestamp(), clock_timestamp(), 0
    ) RETURNING id::int AS id
  `;
  assert.ok(job);
  return job.id;
}

async function expireLease(sql: postgres.Sql, jobId: number) {
  await sql`
    UPDATE import_jobs
    SET lease_expires_at = started_at, heartbeat_at = started_at
    WHERE id = ${jobId}
  `;
}

async function songCount(sql: postgres.Sql) {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM songs
  `;
  return row?.count ?? 0;
}

async function readMutableJobState(sql: postgres.Sql, jobId: number) {
  const [row] = await sql`
    SELECT status::text, total_rows, processed_count, imported_count,
      skipped_count, error_count, claim_token::text, lease_expires_at::text,
      heartbeat_at::text, finished_at::text
    FROM import_jobs WHERE id = ${jobId}
  `;
  assert.ok(row);
  return row;
}

function song(id: number) {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    duration: 180,
    genre: ["Pop"],
    languages: ["Polish"],
  };
}

function page(songs: unknown[]) {
  return { data: { found: songs.length, q: "", results: { songs } }, links: {} };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

type Harness = Awaited<ReturnType<typeof startPostgresTestHarness>>;
