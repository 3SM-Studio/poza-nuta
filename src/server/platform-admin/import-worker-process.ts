import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  classifyISingImportFailure,
  createISingSongBatchWriter,
  loadISingAdapterOptions,
  runISingImportAdapter,
} from "../../db/ising-import-adapter.ts";
import * as schema from "../../db/schema.ts";
import { createImportWorkerServices } from "./import-worker.ts";
import { runImportWorker } from "./import-worker-runtime-core.ts";

const defaultPollingIntervalMs = 5_000;
const defaultPollingJitterMs = 1_000;

config({ path: [".env.local", ".env"], quiet: true });

export function loadImportWorkerProcessOptions(
  env: NodeJS.ProcessEnv,
  args: string[],
) {
  const once = parseWorkerArguments(args);
  const databaseUrl = requiredWorkerDatabaseUrl(env.IMPORT_WORKER_DATABASE_URL);
  const isingOptions = loadISingAdapterOptions(env, "write");
  if (!once && isingOptions.limit !== null) {
    throw new Error(
      "ISING_IMPORT_LIMIT is allowed only for a controlled --once worker run.",
    );
  }

  return {
    databaseUrl,
    isingOptions,
    once,
    pollingIntervalMs: parseBoundedInteger(
      env.IMPORT_WORKER_POLL_INTERVAL_MS,
      "IMPORT_WORKER_POLL_INTERVAL_MS",
      defaultPollingIntervalMs,
      100,
      60_000,
    ),
    pollingJitterMs: parseBoundedInteger(
      env.IMPORT_WORKER_POLL_JITTER_MS,
      "IMPORT_WORKER_POLL_JITTER_MS",
      defaultPollingJitterMs,
      0,
      60_000,
    ),
  };
}

export async function runImportWorkerProcess(
  env: NodeJS.ProcessEnv,
  args: string[],
): Promise<void> {
  const options = loadImportWorkerProcessOptions(env, args);
  if (options.pollingJitterMs > options.pollingIntervalMs) {
    throw new Error("The import worker polling jitter exceeds its interval.");
  }

  let stopping = false;
  const waiters = new Set<() => void>();
  const requestStop = () => {
    stopping = true;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  const client = createImportWorkerConnection(options.databaseUrl);
  try {
    await assertImportWorkerIdentity(client);

    const database = drizzle({ client, schema });
    const workerServices = createImportWorkerServices(database);
    const persistBatch = createISingSongBatchWriter(database);

    const result = await runImportWorker(
      {
        once: options.once,
        pollingIntervalMs: options.pollingIntervalMs,
        pollingJitterMs: options.pollingJitterMs,
      },
      {
        services: {
          assertWorkerIdentity: () => assertImportWorkerIdentity(client),
          recoverExpiredImportJobs: () =>
            workerServices.recoverExpiredImportJobs(),
          claimNextImportJob: () =>
            workerServices.claimNextImportJob(["ising"]),
          checkpointImportJob: workerServices.checkpointImportJob,
          updateImportJobProgress: workerServices.updateImportJobProgress,
          completeImportJob: workerServices.completeImportJob,
          failImportJob: workerServices.failImportJob,
        },
        executeISing: async ({ claim, checkpoint }) =>
          runISingImportAdapter(
            { ...options.isingOptions, mode: claim.mode },
            {
              persistBatch: claim.mode === "write" ? persistBatch : undefined,
              checkpoint: ({ phase, progress }) => checkpoint(phase, progress),
            },
          ),
        classifyISingFailure: classifyISingImportFailure,
        isStopping: () => stopping,
        wait: (milliseconds) => waitForNextPoll(milliseconds, waiters),
        random: Math.random,
      },
    );

    console.log(`Import worker result: ${result}.`);
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    await client.end({ timeout: 5 });
  }
}

export function createImportWorkerConnection(databaseUrl: string): postgres.Sql {
  return postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 0,
    max: 1,
    prepare: false,
    connection: {
      options: "-c role=import_worker",
      idle_in_transaction_session_timeout: 9_000,
      statement_timeout: 9_000,
    },
  });
}

export async function assertImportWorkerIdentity(
  connection: postgres.Sql,
): Promise<void> {
  const rows = await connection<
    Array<{
      currentRoleValid: boolean;
      separateLogin: boolean;
      sessionCanLogin: boolean;
      sessionDoesNotInherit: boolean;
      sessionCanSetRole: boolean;
      sessionHasExactMembership: boolean;
      sessionHasNoAdminOption: boolean;
      sessionOwnsNothing: boolean;
      sessionHasSafeAttributes: boolean;
      workerCannotLogin: boolean;
      workerDoesNotInherit: boolean;
      workerHasNoParentRole: boolean;
      workerOwnsNothing: boolean;
      workerHasSafeAttributes: boolean;
    }>
  >`
    WITH session_identity AS MATERIALIZED (
      SELECT *
      FROM pg_catalog.pg_roles
      WHERE rolname = session_user
    ),
    worker_identity AS MATERIALIZED (
      SELECT *
      FROM pg_catalog.pg_roles
      WHERE rolname = current_user
    ),
    session_memberships AS (
      SELECT
        count(*)::integer AS total,
        count(*) FILTER (
          WHERE membership.roleid = worker_identity.oid
        )::integer AS worker_memberships,
        coalesce(bool_or(membership.admin_option) FILTER (
          WHERE membership.roleid = worker_identity.oid
        ), false) AS worker_admin_option
      FROM session_identity
      CROSS JOIN worker_identity
      LEFT JOIN pg_catalog.pg_auth_members AS membership
        ON membership.member = session_identity.oid
    ),
    worker_parent_roles AS (
      SELECT count(*)::integer AS total
      FROM worker_identity
      JOIN pg_catalog.pg_auth_members AS membership
        ON membership.member = worker_identity.oid
    ),
    current_database_identity AS (
      SELECT oid, datdba
      FROM pg_catalog.pg_database
      WHERE datname = current_database()
    ),
    scoped_ownership AS (
      SELECT
        role_identity.oid AS role_oid,
        current_database_identity.datdba = role_identity.oid
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS namespace
            WHERE namespace.nspname IN ('public', 'private', 'drizzle')
              AND namespace.nspowner = role_identity.oid
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_shdepend AS dependency
            CROSS JOIN LATERAL pg_catalog.pg_identify_object(
              dependency.classid,
              dependency.objid,
              dependency.objsubid
            ) AS identified
            WHERE dependency.refclassid = 'pg_catalog.pg_authid'::regclass
              AND dependency.refobjid = role_identity.oid
              AND dependency.deptype = 'o'
              AND dependency.dbid = current_database_identity.oid
              AND identified."schema" IN ('public', 'private', 'drizzle')
          ) AS owns_scoped_object
      FROM (
        SELECT oid FROM session_identity
        UNION
        SELECT oid FROM worker_identity
      ) AS role_identity
      CROSS JOIN current_database_identity
    )
    SELECT
      current_user = 'import_worker' AS "currentRoleValid",
      session_user <> current_user AS "separateLogin",
      session_identity.rolcanlogin AS "sessionCanLogin",
      NOT session_identity.rolinherit AS "sessionDoesNotInherit",
      pg_has_role(session_user, 'import_worker', 'MEMBER')
        AS "sessionCanSetRole",
      session_memberships.total = 1
        AND session_memberships.worker_memberships = 1
        AS "sessionHasExactMembership",
      NOT session_memberships.worker_admin_option AS "sessionHasNoAdminOption",
      NOT session_ownership.owns_scoped_object AS "sessionOwnsNothing",
      NOT (
        session_identity.rolsuper
        OR session_identity.rolbypassrls
        OR session_identity.rolcreatedb
        OR session_identity.rolcreaterole
        OR session_identity.rolreplication
      ) AS "sessionHasSafeAttributes",
      NOT worker_identity.rolcanlogin AS "workerCannotLogin",
      NOT worker_identity.rolinherit AS "workerDoesNotInherit",
      worker_parent_roles.total = 0 AS "workerHasNoParentRole",
      NOT worker_ownership.owns_scoped_object AS "workerOwnsNothing",
      NOT (
        worker_identity.rolsuper
        OR worker_identity.rolbypassrls
        OR worker_identity.rolcreatedb
        OR worker_identity.rolcreaterole
        OR worker_identity.rolreplication
      ) AS "workerHasSafeAttributes"
    FROM session_identity
    CROSS JOIN worker_identity
    CROSS JOIN session_memberships
    CROSS JOIN worker_parent_roles
    JOIN scoped_ownership AS session_ownership
      ON session_ownership.role_oid = session_identity.oid
    JOIN scoped_ownership AS worker_ownership
      ON worker_ownership.role_oid = worker_identity.oid
  `;
  const identity = rows[0];
  if (
    !identity?.currentRoleValid ||
    !identity.separateLogin ||
    !identity.sessionCanLogin ||
    !identity.sessionDoesNotInherit ||
    !identity.sessionCanSetRole ||
    !identity.sessionHasExactMembership ||
    !identity.sessionHasNoAdminOption ||
    !identity.sessionOwnsNothing ||
    !identity.sessionHasSafeAttributes ||
    !identity.workerCannotLogin ||
    !identity.workerDoesNotInherit ||
    !identity.workerHasNoParentRole ||
    !identity.workerOwnsNothing ||
    !identity.workerHasSafeAttributes
  ) {
    throw new Error("The import worker database role is invalid.");
  }
}

function parseWorkerArguments(args: string[]) {
  let once = false;
  for (const argument of args) {
    if (argument === "--") continue;
    if (argument === "--once") {
      once = true;
      continue;
    }
    throw new Error(`Unknown import worker option: ${argument}`);
  }
  return once;
}

function requiredWorkerDatabaseUrl(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized === "replace_me") {
    throw new Error("IMPORT_WORKER_DATABASE_URL is not configured.");
  }
  return normalized;
}

function parseBoundedInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its allowed range.`);
  }
  return parsed;
}

function waitForNextPoll(milliseconds: number, waiters: Set<() => void>) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      waiters.delete(finish);
      resolve();
    };
    const timeoutId = setTimeout(finish, milliseconds);
    waiters.add(finish);
  });
}

if (process.argv[1]?.endsWith("import-worker-process.ts")) {
  runImportWorkerProcess(process.env, process.argv.slice(2)).catch(() => {
    console.error("The import worker stopped safely.");
    process.exitCode = 1;
  });
}
