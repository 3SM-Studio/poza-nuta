import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { DATABASE_MAX_CONNECTIONS } from "../../src/server/db-client-options.ts";

const APP_PORT = 31_15;
const API_PORT = 56_431;
const DB_PORT = 56_432;
const SHADOW_DB_PORT = 56_430;
const STUDIO_PORT = 56_433;
const MAIL_PORT = 56_434;
const ANALYTICS_PORT = 56_437;
const PROJECT_ID = "pozanuta-stage5-load";
const NEXT_DIST_DIRECTORY = ".next-stage5-load";
const ORIGIN = `http://localhost:${APP_PORT}`;
const LOCAL_SUPABASE_URL = `http://127.0.0.1:${API_PORT}`;
const SCENARIO_TIMEOUT_MS = 20_000;
const LEVELS = [10, 25, 50, 100] as const;
const ERROR_CLASSES = [
  "DB_LOCK_TIMEOUT",
  "DB_STATEMENT_TIMEOUT",
  "DB_CONNECT_TIMEOUT",
  "DB_CONNECTION_CAPACITY",
  "DB_CONNECTION_CLOSED",
  "APP_DEADLINE_EXCEEDED",
  "UNKNOWN_DB_ERROR",
] as const;

type ErrorClass = (typeof ERROR_CLASSES)[number];
type RequestKind = "queue" | "mine" | "create" | "operator";
type RequestGroup = "all" | "hot" | "other" | "control";

type ClientFixture = {
  credential: string;
  displayName: string;
};

type EventFixture = {
  id: number;
  publicId: string;
  publicToken: string;
  sessionId: number;
  clients: ClientFixture[];
  operatorTargetIds: number[];
};

type LoadFixture = {
  organizationId: string;
  operatorEmail: string;
  operatorPassword: string;
  events: EventFixture[];
  songIds: number[];
};

type MeasuredRequest = {
  id: string;
  kind: RequestKind;
  group: RequestGroup;
  latencyMs: number;
  status: number | null;
  errorCode: string | null;
  semanticOk: boolean;
  clientError: string | null;
  createdRequestId: string | null;
  songId: number | null;
};

type LatencySummary = {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

type RequestSummary = LatencySummary & {
  totalRequests: number;
  successes: number;
  expectedConflicts: number;
  unexpected4xx: number;
  serverErrors: number;
  clientErrors: number;
  semanticFailures: number;
  durationMs: number;
  requestsPerSecond: number;
  errorCodes: Record<string, number>;
};

type ActivitySnapshot = {
  totalConnections: number;
  idleConnections: number;
  activeQueries: number;
  idleInTransaction: number;
  lockWaiters: number;
  blockedBackends: number;
};

type RecoveryResult = {
  activity: ActivitySnapshot;
  controlRequest: RequestSummary;
};

type InvariantResult = {
  attempted: number;
  successfulResponses: number;
  storedSuccessfulRequests: number;
  missingSuccessfulRequests: number;
  unexpectedStoredRequests: number;
  duplicatePositivePositions: number;
  nonContiguousCreatedPositions: boolean;
  impossibleStatuses: number;
  deadlocksObserved: number;
};

type ScenarioRun = {
  label: string;
  summary: RequestSummary;
  dbErrors: Record<ErrorClass, number>;
  recovery: RecoveryResult;
  operations: Record<string, RequestSummary>;
  groups?: Record<string, RequestSummary>;
  invariants?: InvariantResult;
  evidence?: Record<string, unknown>;
};

type RepeatAggregate = {
  runs: number;
  median: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    durationMs: number;
    requestsPerSecond: number;
  };
  worstP95Ms: number;
  worstMaxMs: number;
  errorsAcrossRuns: {
    expectedConflicts: number;
    unexpected4xx: number;
    serverErrors: number;
    clientErrors: number;
    semanticFailures: number;
    dbErrors: Record<ErrorClass, number>;
  };
};

type DbTelemetryEntry = {
  request_id?: string;
  phase?: string;
  error_class?: string;
};

type ServerFailureEntry = {
  requestId: string;
  errorClass: string;
};

type TelemetryCursor = {
  db: number;
  server: number;
};

type NextProcess = {
  child: ChildProcess;
  dbTelemetry: DbTelemetryEntry[];
  serverFailures: ServerFailureEntry[];
  tail: string[];
};

type CookieJar = Map<string, string>;
type RequestTask = () => Promise<MeasuredRequest>;

const repoRoot = resolve(import.meta.dirname, "../..");
const reportDirectory = resolve(repoRoot, "test-results/load");
const nextDistPath = resolve(repoRoot, NEXT_DIST_DIRECTORY);
const tsconfigPath = resolve(repoRoot, "tsconfig.json");
assert.equal(dirname(nextDistPath), repoRoot);
assert.equal(basename(nextDistPath), NEXT_DIST_DIRECTORY);
const initialTsconfig = await readFile(tsconfigPath, "utf8");

const projectRoot = await mkdtemp(join(tmpdir(), "pozanuta-stage5-load-"));
const supabaseDirectory = join(projectRoot, "supabase");
assert.equal(resolve(projectRoot).startsWith(resolve(tmpdir())), true);

let nextProcess: NextProcess | undefined;
let database: postgres.Sql | undefined;
let localStackStarted = false;
let localDatabaseUrl: string | undefined;
let supabaseCliVersion = "NOT_MEASURED";
let postgresServerVersion = "NOT_MEASURED";

try {
  await assertPortsAvailable([
    APP_PORT,
    API_PORT,
    DB_PORT,
    SHADOW_DB_PORT,
    STUDIO_PORT,
    MAIL_PORT,
    ANALYTICS_PORT,
  ]);
  assert.equal(DATABASE_MAX_CONNECTIONS, 2, "The application pool is no longer configured with max=2.");
  const versionResult = await runCaptured(
    "supabase",
    ["--version"],
    { ...process.env, DO_NOT_TRACK: "1", SUPABASE_TELEMETRY_DISABLED: "1" },
    30_000,
  );
  assert.equal(versionResult.exitCode, 0, "The local Supabase CLI version could not be read.");
  supabaseCliVersion = versionResult.stdout.trim();
  await mkdir(supabaseDirectory, { recursive: true });
  await writeFile(
    join(supabaseDirectory, "config.toml"),
    createLocalSupabaseConfig(),
    "utf8",
  );

  await runSupabase(["stop", "--project-id", PROJECT_ID, "--no-backup"], true);
  console.log("[stage5-load] Starting isolated local Supabase Auth, Realtime, and PostgreSQL.");
  await runSupabase([
    "start",
    "--exclude",
    "storage-api,imgproxy,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ]);
  localStackStarted = true;

  const status = parseStatusEnvironment(
    await runSupabase(["status", "--output", "env"]),
  );
  const databaseUrl = requireStatusValue(status, "DB_URL");
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  assert.ok(publishableKey, "Local Supabase did not expose a publishable key.");
  assert.ok(secretKey, "Local Supabase did not expose a secret key.");
  assertLocalEphemeralTargets(databaseUrl, LOCAL_SUPABASE_URL);
  localDatabaseUrl = databaseUrl;

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    DO_NOT_TRACK: "1",
    NEXT_DIST_DIR: NEXT_DIST_DIRECTORY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
    SITE_URL: ORIGIN,
    SUPABASE_TELEMETRY_DISABLED: "1",
    VERCEL: "0",
  };

  console.log("[stage5-load] Applying all committed Drizzle migrations to the isolated database.");
  await runCapturedChecked("pnpm.cmd", ["db:migrate"], environment);
  database = postgres(databaseUrl, {
    max: 4,
    connect_timeout: 10,
    idle_timeout: 20,
    prepare: false,
    onnotice: () => undefined,
  });
  const [serverVersion] = await database<{ server_version: string }[]>`
    SHOW server_version
  `;
  postgresServerVersion = serverVersion?.server_version ?? "NOT_MEASURED";

  console.log("[stage5-load] Seeding five events, 500 participant credentials, and the song catalog fixture.");
  const fixture = await seedFixture(database, {
    supabaseUrl: LOCAL_SUPABASE_URL,
    secretKey,
  });

  await rm(nextDistPath, { recursive: true, force: true });
  console.log("[stage5-load] Building the current dirty worktree for production-mode HTTP testing.");
  await runCapturedChecked("pnpm.cmd", ["build"], environment, 10 * 60_000);

  console.log("[stage5-load] Starting one Next.js production process; application postgres.js pool max remains 2.");
  nextProcess = await startNextProcess(environment);
  const operatorCookies = await loginOperator(fixture);
  await warmApplication(fixture, operatorCookies);

  const songCursor = { value: 0 };
  console.log("[stage5-load] Harness smoke: public read/create/refresh pair, operator action, recovery inspection.");
  const smoke = await runHarnessSmoke(
    fixture,
    fixture.songIds,
    songCursor,
    operatorCookies,
    nextProcess,
    database,
  );
  console.log(JSON.stringify({ smoke: compactRun(smoke) }, null, 2));
  assertRealisticHealthy(smoke);

  const scenarioA: Record<string, ScenarioRun[]> = {};
  for (const level of LEVELS) {
    const repetitions = level === 100 ? 3 : 1;
    scenarioA[String(level)] = [];
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const label = `A${level}${repetitions > 1 ? `-run${repetition}` : ""}`;
      console.log(`[stage5-load] ${label}: ${level * 2} HTTP reads in one burst.`);
      const run = await runScenarioA(label, fixture.events[0], level, nextProcess, database);
      assertRealisticHealthy(run);
      scenarioA[String(level)].push(run);
    }
  }

  const scenarioB: Record<string, ScenarioRun[]> = {};
  for (const level of LEVELS) {
    const label = `B${level}`;
    console.log(`[stage5-load] ${label}: ${level} concurrent public creates.`);
    const run = await runScenarioB(
      label,
      fixture.events[0],
      fixture.songIds,
      songCursor,
      level,
      nextProcess,
      database,
    );
    if (level <= 25) assertRealisticHealthy(run);
    else assertStressIntegrity(run);
    scenarioB[String(level)] = [run];
  }

  const writeCounts: Record<(typeof LEVELS)[number], number> = {
    10: 2,
    25: 3,
    50: 5,
    100: 10,
  };
  const scenarioC: Record<string, ScenarioRun[]> = {};
  let operatorTargetCursor = 1;
  for (const level of LEVELS) {
    const repetitions = level === 100 ? 3 : 1;
    scenarioC[String(level)] = [];
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const label = `C${level}${repetitions > 1 ? `-run${repetition}` : ""}`;
      console.log(`[stage5-load] ${label}: public 2xGET fan-out, ${writeCounts[level]} creates, one operator HTTP action.`);
      const operatorTargetId = fixture.events[0].operatorTargetIds[operatorTargetCursor];
      assert.ok(operatorTargetId, "The mixed scenario exhausted operator target requests.");
      operatorTargetCursor += 1;
      const run = await runScenarioC(
        label,
        fixture,
        fixture.songIds,
        songCursor,
        level,
        writeCounts[level],
        operatorTargetId,
        operatorCookies,
        nextProcess,
        database,
      );
      assertRealisticHealthy(run);
      scenarioC[String(level)].push(run);
    }
  }

  const scenarioD: ScenarioRun[] = [];
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    const label = `D-run${repetition}`;
    console.log(`[stage5-load] ${label}: 20 hot-event writes and 160 unrelated-event reads.`);
    const run = await runScenarioD(
      label,
      fixture,
      fixture.songIds,
      songCursor,
      nextProcess,
      database,
    );
    assertRealisticHealthy(run);
    scenarioD.push(run);
  }

  console.log("[stage5-load] E: deliberate >2s queue-mutex blocker with unrelated-event work.");
  const scenarioE = await runScenarioE(
    fixture,
    fixture.songIds,
    songCursor,
    nextProcess,
    database,
  );
  assertDeliberateLockResult(scenarioE);

  console.log("[stage5-load] Incident probe: attempt two hot waiters against the two-slot app pool while unrelated reads arrive.");
  const incidentProbe = await runIncidentProbe(
    fixture,
    fixture.songIds,
    songCursor,
    nextProcess,
    database,
  );
  assertStressIntegrity(incidentProbe);

  const finalActivity = await readActivity(database);
  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      execution: "LOCAL_ONLY",
      applicationBoundary: "HTTP_NEXT_PRODUCTION",
      nextProcesses: 1,
      postgresJsApplicationPoolMax: DATABASE_MAX_CONNECTIONS,
      adminObserverPoolMax: 4,
      blockerPoolMax: 1,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      supabaseCliVersion,
      postgresServerVersion,
      database: "Supabase CLI local PostgreSQL, direct connection, pooler disabled",
      migrations: "all committed Drizzle migrations",
      realtimeBoundary: "No WebSocket load; simulated post-Stage-4 fan-out as two HTTP GETs per public client",
      limitations: [
        "Not a Vercel isolate fleet simulation",
        "Not a Supabase Transaction Pooler simulation",
        "No production network latency",
        "No global multi-isolate connection count",
      ],
    },
    fixture: {
      events: fixture.events.length,
      participantsPerEvent: fixture.events[0].clients.length,
      totalParticipantCredentials: fixture.events.reduce((sum, event) => sum + event.clients.length, 0),
      songs: fixture.songIds.length,
    },
    smoke,
    scenarioA,
    scenarioAAggregate100: aggregateRuns(scenarioA["100"]),
    scenarioB,
    scenarioC,
    scenarioCAggregate100: aggregateRuns(scenarioC["100"]),
    scenarioD,
    scenarioDAggregate: aggregateRuns(scenarioD),
    scenarioE,
    incidentProbe,
    finalActivity,
  };

  await mkdir(reportDirectory, { recursive: true });
  const reportPath = join(reportDirectory, "db-contention-load-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[stage5-load] Report written to ${reportPath}`);
  console.log(JSON.stringify(compactReport(report), null, 2));
} finally {
  if (nextProcess) await stopNextProcess(nextProcess.child);
  if (database) await database.end({ timeout: 5 }).catch(() => undefined);
  if (localStackStarted) {
    console.log("[stage5-load] Removing isolated Supabase containers and data.");
  }
  await runSupabase(["stop", "--project-id", PROJECT_ID, "--no-backup"], true);
  await rm(nextDistPath, { recursive: true, force: true });
  await rm(projectRoot, { recursive: true, force: true });
  await restoreTsconfigAfterNextBuild(tsconfigPath, initialTsconfig);
}

async function restoreTsconfigAfterNextBuild(path: string, initial: string): Promise<void> {
  const current = await readFile(path, "utf8");
  if (current === initial) return;

  const initialConfig = JSON.parse(initial) as { include?: unknown } & Record<string, unknown>;
  const currentConfig = JSON.parse(current) as { include?: unknown } & Record<string, unknown>;
  assert.ok(Array.isArray(initialConfig.include), "The initial tsconfig include list is missing.");
  assert.ok(Array.isArray(currentConfig.include), "The current tsconfig include list is missing.");

  const initialIncludes = initialConfig.include as unknown[];
  const currentIncludes = currentConfig.include as unknown[];
  const generatedIncludes = new Set([
    `${NEXT_DIST_DIRECTORY}/types/**/*.ts`,
    `${NEXT_DIST_DIRECTORY}/dev/types/**/*.ts`,
  ]);
  const additions = currentIncludes.filter((entry) => !initialIncludes.includes(entry));
  assert.ok(
    additions.every((entry) => typeof entry === "string" && generatedIncludes.has(entry)),
    "Refusing to restore tsconfig because it changed beyond Next.js generated load-build includes.",
  );

  const normalizedCurrent = { ...currentConfig, include: initialIncludes };
  assert.deepEqual(
    normalizedCurrent,
    initialConfig,
    "Refusing to restore tsconfig because it changed beyond Next.js generated load-build includes.",
  );
  await writeFile(path, initial, "utf8");
}

async function runHarnessSmoke(
  fixture: LoadFixture,
  songIds: number[],
  songCursor: { value: number },
  operatorCookies: CookieJar,
  next: NextProcess,
  sql: postgres.Sql,
): Promise<ScenarioRun> {
  const label = "smoke";
  const event = fixture.events[0];
  const cursor = telemetryCursor(next);
  const publicRead = await queueRequest(label, event, 20_000, "control");
  const created = await createRequest(
    label,
    event,
    event.clients[0],
    takeSong(songIds, songCursor),
    20_001,
    "control",
  );
  const refreshPair = await withScenarioDeadline(
    Promise.all([
      queueRequest(`${label}-pair`, event, 20_002, "control"),
      mineRequest(`${label}-pair`, event, event.clients[0], 20_002, "control"),
    ]),
    `${label}-refresh-pair`,
  );
  const operator = await operatorActionRequest(
    label,
    fixture.organizationId,
    event,
    event.operatorTargetIds[0],
    operatorCookies,
  );
  const results = [publicRead, created, ...refreshPair, operator];
  const invariants = await checkCreateInvariants(sql, event, 1, [created]);
  await deleteCreatedRequests(sql, [created]);
  const recovery = await recover(sql, event, `${label}-recovery`);
  return {
    label,
    summary: summarizeRequests(results, sum(results.map((result) => result.latencyMs))),
    dbErrors: countDbErrors(next, cursor),
    recovery,
    operations: summarizeOperations(results),
    invariants,
  };
}

async function runScenarioA(
  label: string,
  event: EventFixture,
  clientCount: number,
  next: NextProcess,
  sql: postgres.Sql,
): Promise<ScenarioRun> {
  const cursor = telemetryCursor(next);
  const tasks: RequestTask[] = [];
  for (let index = 0; index < clientCount; index += 1) {
    const client = event.clients[index];
    tasks.push(() => queueRequest(label, event, index, "all"));
    tasks.push(() => mineRequest(label, event, client, index, "all"));
  }
  const { results, durationMs } = await runBurst(label, tasks);
  await delay(100);
  const recovery = await recover(sql, event, `${label}-recovery`);
  return {
    label,
    summary: summarizeRequests(results, durationMs),
    dbErrors: countDbErrors(next, cursor),
    recovery,
    operations: summarizeOperations(results),
  };
}

async function runScenarioB(
  label: string,
  event: EventFixture,
  songIds: number[],
  songCursor: { value: number },
  clientCount: number,
  next: NextProcess,
  sql: postgres.Sql,
): Promise<ScenarioRun> {
  const cursor = telemetryCursor(next);
  const tasks: RequestTask[] = [];
  for (let index = 0; index < clientCount; index += 1) {
    tasks.push(
      () => createRequest(
        label,
        event,
        event.clients[index],
        takeSong(songIds, songCursor),
        index,
        "all",
      ),
    );
  }
  const { results, durationMs } = await runBurst(label, tasks);
  await delay(100);
  const invariants = await checkCreateInvariants(sql, event, clientCount, results);
  await deleteCreatedRequests(sql, results);
  const recovery = await recover(sql, event, `${label}-recovery`);
  return {
    label,
    summary: summarizeRequests(results, durationMs),
    dbErrors: countDbErrors(next, cursor),
    invariants,
    recovery,
    operations: summarizeOperations(results),
  };
}

async function runScenarioC(
  label: string,
  fixture: LoadFixture,
  songIds: number[],
  songCursor: { value: number },
  clientCount: number,
  writeCount: number,
  operatorTargetId: number,
  operatorCookies: CookieJar,
  next: NextProcess,
  sql: postgres.Sql,
): Promise<ScenarioRun> {
  const event = fixture.events[0];
  const cursor = telemetryCursor(next);
  const tasks: RequestTask[] = [];
  for (let index = 0; index < clientCount; index += 1) {
    const client = event.clients[index];
    tasks.push(() => queueRequest(label, event, index, "all"));
    tasks.push(() => mineRequest(label, event, client, index, "all"));
  }
  for (let index = 0; index < writeCount; index += 1) {
    tasks.push(
      () => createRequest(
        label,
        event,
        event.clients[index],
        takeSong(songIds, songCursor),
        500 + index,
        "all",
      ),
    );
  }
  tasks.push(
    () => operatorActionRequest(
      label,
      fixture.organizationId,
      event,
      operatorTargetId,
      operatorCookies,
    ),
  );

  const { results, durationMs } = await runBurst(label, tasks);
  await delay(100);
  const createResults = results.filter((result) => result.kind === "create");
  const invariants = await checkCreateInvariants(sql, event, writeCount, createResults);
  await deleteCreatedRequests(sql, createResults);
  const recovery = await recover(sql, event, `${label}-recovery`);
  return {
    label,
    summary: summarizeRequests(results, durationMs),
    dbErrors: countDbErrors(next, cursor),
    invariants,
    recovery,
    operations: summarizeOperations(results),
  };
}

async function runScenarioD(
  label: string,
  fixture: LoadFixture,
  songIds: number[],
  songCursor: { value: number },
  next: NextProcess,
  sql: postgres.Sql,
): Promise<ScenarioRun> {
  const hotEvent = fixture.events[0];
  const cursor = telemetryCursor(next);
  const tasks: RequestTask[] = [];

  for (let index = 0; index < 20; index += 1) {
    tasks.push(
      () => createRequest(
        label,
        hotEvent,
        hotEvent.clients[index],
        takeSong(songIds, songCursor),
        index,
        "hot",
      ),
    );
  }
  for (let eventIndex = 1; eventIndex < fixture.events.length; eventIndex += 1) {
    const event = fixture.events[eventIndex];
    for (let index = 0; index < 20; index += 1) {
      tasks.push(() => queueRequest(label, event, eventIndex * 100 + index, "other"));
      tasks.push(
        () => mineRequest(
          label,
          event,
          event.clients[index],
          eventIndex * 100 + index,
          "other",
        ),
      );
    }
  }

  const { results, durationMs } = await runBurst(label, tasks);
  await delay(100);
  const hot = results.filter((result) => result.group === "hot");
  const other = results.filter((result) => result.group === "other");
  const invariants = await checkCreateInvariants(sql, hotEvent, 20, hot);
  await deleteCreatedRequests(sql, hot);
  const recovery = await recover(sql, hotEvent, `${label}-recovery`);
  return {
    label,
    summary: summarizeRequests(results, durationMs),
    groups: {
      hot: summarizeRequests(hot, groupDuration(hot)),
      other: summarizeRequests(other, groupDuration(other)),
    },
    dbErrors: countDbErrors(next, cursor),
    invariants,
    recovery,
    operations: summarizeOperations(results),
  };
}

async function runScenarioE(
  fixture: LoadFixture,
  songIds: number[],
  songCursor: { value: number },
  next: NextProcess,
  sql: postgres.Sql,
): Promise<ScenarioRun> {
  const hotEvent = fixture.events[0];
  const otherEvent = fixture.events[1];
  const blocker = await holdQueueMutex(hotEvent.sessionId);
  const cursor = telemetryCursor(next);
  const releaseTimer = setTimeout(() => blocker.release(), 2_600);
  const started = performance.now();
  const hotPromise = createRequest(
    "E",
    hotEvent,
    hotEvent.clients[98],
    takeSong(songIds, songCursor),
    980,
    "hot",
  );
  const otherReadPromise = queueRequest("E", otherEvent, 981, "other");
  const otherWritePromise = createRequest(
    "E",
    otherEvent,
    otherEvent.clients[98],
    takeSong(songIds, songCursor),
    982,
    "other",
  );
  const results = await Promise.all([hotPromise, otherReadPromise, otherWritePromise]);
  await blocker.done;
  clearTimeout(releaseTimer);
  const durationMs = performance.now() - started;
  await delay(100);

  const postRelease = await createRequest(
    "E-post-release",
    hotEvent,
    hotEvent.clients[99],
    takeSong(songIds, songCursor),
    999,
    "control",
  );
  const hotResult = results.find((result) => result.group === "hot");
  const otherResults = results.filter((result) => result.group === "other");
  assert.ok(hotResult);
  await deleteCreatedRequests(sql, [...otherResults, postRelease]);
  const recovery = await recover(sql, hotEvent, "E-recovery");
  return {
    label: "E",
    summary: summarizeRequests(results, durationMs),
    groups: {
      hot: summarizeRequests([hotResult], hotResult.latencyMs),
      other: summarizeRequests(otherResults, groupDuration(otherResults)),
      postRelease: summarizeRequests([postRelease], postRelease.latencyMs),
    },
    dbErrors: countDbErrors(next, cursor),
    recovery,
    operations: summarizeOperations([...results, postRelease]),
    evidence: {
      blockerPid: blocker.pid,
      blockerHeldMs: 2_600,
      hotStatus: hotResult.status,
      hotErrorCode: hotResult.errorCode,
      hotLatencyMs: round(hotResult.latencyMs),
      postReleaseStatus: postRelease.status,
      postReleaseLatencyMs: round(postRelease.latencyMs),
    },
  };
}

async function runIncidentProbe(
  fixture: LoadFixture,
  songIds: number[],
  songCursor: { value: number },
  next: NextProcess,
  sql: postgres.Sql,
): Promise<ScenarioRun> {
  const hotEvent = fixture.events[0];
  const otherEvent = fixture.events[1];
  const blocker = await holdQueueMutex(hotEvent.sessionId);
  const cursor = telemetryCursor(next);
  const releaseTimer = setTimeout(() => blocker.release(), 2_800);
  const started = performance.now();
  const hotPromises = [
    createRequest("incident-probe", hotEvent, hotEvent.clients[96], takeSong(songIds, songCursor), 960, "hot"),
    createRequest("incident-probe", hotEvent, hotEvent.clients[97], takeSong(songIds, songCursor), 970, "hot"),
  ];
  const observedWaiters = await waitForBlockedWaiters(sql, blocker.pid, 2, 1_500);
  const otherPromises: Promise<MeasuredRequest>[] = [];
  for (let index = 0; index < 40; index += 1) {
    otherPromises.push(queueRequest("incident-probe", otherEvent, 1_000 + index, "other"));
  }
  const results = await Promise.all([...hotPromises, ...otherPromises]);
  await blocker.done;
  clearTimeout(releaseTimer);
  const durationMs = performance.now() - started;
  await delay(100);
  const hot = results.filter((result) => result.group === "hot");
  const other = results.filter((result) => result.group === "other");
  await deleteCreatedRequests(sql, results);
  const recovery = await recover(sql, hotEvent, "incident-probe-recovery");
  return {
    label: "incident-probe",
    summary: summarizeRequests(results, durationMs),
    groups: {
      hot: summarizeRequests(hot, groupDuration(hot)),
      other: summarizeRequests(other, groupDuration(other)),
    },
    dbErrors: countDbErrors(next, cursor),
    recovery,
    operations: summarizeOperations(results),
    evidence: {
      observedSimultaneousBlockedAppBackends: observedWaiters,
      blockerHeldMs: 2_800,
      hotStatuses: hot.map((result) => result.status),
      otherReadMinMs: round(Math.min(...other.map((result) => result.latencyMs))),
      otherReadMaxMs: round(Math.max(...other.map((result) => result.latencyMs))),
    },
  };
}

async function seedFixture(
  sql: postgres.Sql,
  supabase: { supabaseUrl: string; secretKey: string },
): Promise<LoadFixture> {
  const admin = createClient(supabase.supabaseUrl, supabase.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const suffix = randomUUID().replaceAll("-", "");
  const operatorEmail = `stage5-${suffix}@example.test`;
  const operatorPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
  const authResult = await admin.auth.admin.createUser({
    email: operatorEmail,
    password: operatorPassword,
    email_confirm: true,
  });
  if (authResult.error || !authResult.data.user) {
    throw new Error("Local Auth operator fixture could not be created.");
  }

  const organizationId = suffix.slice(0, 20);
  const events: EventFixture[] = [];
  const songIds: number[] = [];

  await sql.begin(async (transaction) => {
    const [operator] = await transaction<{ id: number }[]>`
      INSERT INTO public.operator_users (
        name, display_name, profile_completed_at, auth_user_id, password_hash, active
      ) VALUES (
        ${`Stage 5 Operator ${suffix.slice(0, 8)}`},
        'Stage 5 Operator',
        now(),
        ${authResult.data.user.id}::uuid,
        'supabase-auth-managed',
        true
      ) RETURNING id::integer
    `;
    const [workspace] = await transaction<{ id: number }[]>`
      INSERT INTO public.workspaces (public_id, name, handle, active)
      VALUES (${organizationId}, 'Stage 5 Load Workspace', ${`load-${suffix.slice(0, 12)}`}, true)
      RETURNING id::integer
    `;
    assert.ok(operator && workspace);
    await transaction`
      INSERT INTO public.workspace_members (workspace_id, operator_user_id, role, active)
      VALUES (${workspace.id}, ${operator.id}, 'owner', true)
    `;

    for (let index = 0; index < 5; index += 1) {
      const publicId = randomUUID();
      const publicToken = randomBytes(16).toString("base64url");
      const sessionCode = String(81_000_000 + index);
      const [event] = await transaction<{ id: number }[]>`
        INSERT INTO public.events (
          public_id, workspace_id, name, slug, venue, city, session_code,
          starts_at, status, visibility, published_at, is_active_public_event,
          public_queue_enabled, song_requests_enabled, public_show_song_titles,
          auto_close_at, ends_at
        ) VALUES (
          ${publicId}::uuid,
          ${workspace.id},
          ${`Stage 5 Event ${index + 1}`},
          ${`stage5-event-${index + 1}-${suffix.slice(0, 6)}`},
          'Local Load Venue',
          'Warszawa',
          ${sessionCode},
          now() - interval '1 hour',
          'active',
          'public',
          now(),
          ${index === 0},
          true,
          true,
          true,
          now() + interval '2 hours',
          now() + interval '2 hours'
        ) RETURNING id::integer
      `;
      assert.ok(event);
      const [session] = await transaction<{ id: number }[]>`
        INSERT INTO public.event_sessions (event_id, public_token)
        VALUES (${event.id}, ${publicToken})
        RETURNING id::integer
      `;
      assert.ok(session);
      await transaction`
        INSERT INTO public.event_session_codes (
          session_id, code, created_by_operator_id, rotation_reason
        ) VALUES (${session.id}, ${sessionCode}, ${operator.id}, 'initial')
      `;
      events.push({
        id: event.id,
        publicId,
        publicToken,
        sessionId: session.id,
        clients: [],
        operatorTargetIds: [],
      });
    }

    for (let index = 0; index < 500; index += 1) {
      const [song] = await transaction<{ id: number }[]>`
        INSERT INTO public.songs (
          source, source_song_id, title, artist, normalized_title,
          normalized_artist, search_text, genres, languages, is_hit
        ) VALUES (
          'manual',
          ${`stage5-${suffix}-${index}`},
          ${`Stage 5 Song ${index + 1}`},
          ${`Load Artist ${index % 25}`},
          ${`stage 5 song ${index + 1}`},
          ${`load artist ${index % 25}`},
          ${`stage 5 song ${index + 1} load artist ${index % 25}`},
          ARRAY['Pop']::text[],
          ARRAY['Polish']::text[],
          ${index % 10 === 0}
        ) RETURNING id::integer
      `;
      assert.ok(song);
      songIds.push(song.id);
    }

    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex];
      for (let index = 0; index < 100; index += 1) {
        const credential = randomBytes(32).toString("base64url");
        const tokenHash = createHash("sha256").update(credential, "utf8").digest("hex");
        const displayName = `Singer ${eventIndex + 1}-${String(index + 1).padStart(3, "0")}`;
        const [identity] = await transaction<{ id: number }[]>`
          INSERT INTO public.participant_identities DEFAULT VALUES
          RETURNING id::integer
        `;
        assert.ok(identity);
        await transaction`
          INSERT INTO public.participant_credentials (
            participant_id, token_hash, expires_at, last_used_at
          ) VALUES (${identity.id}, ${tokenHash}, now() + interval '180 days', now())
        `;
        await transaction`
          INSERT INTO public.event_participants (
            event_session_id, participant_id, display_name, normalized_display_name
          ) VALUES (${event.sessionId}, ${identity.id}, ${displayName}, ${displayName.toLowerCase()})
        `;
        event.clients.push({ credential, displayName });
      }

      for (let position = 1; position <= 10; position += 1) {
        await transaction`
          INSERT INTO public.song_requests (
            event_id, song_id, singer_name, display_name, status, position, requested_by
          ) VALUES (
            ${event.id}, ${songIds[position - 1]}, ${`Seed ${eventIndex + 1}-${position}`},
            ${`Seed ${eventIndex + 1}-${position}`}, 'approved', ${position}, 'operator'
          )
        `;
      }

      for (let index = 0; index < 8; index += 1) {
        const [target] = await transaction<{ id: number }[]>`
          INSERT INTO public.song_requests (
            event_id, song_id, singer_name, display_name, status, position, requested_by
          ) VALUES (
            ${event.id}, ${songIds[20 + index]}, ${`Operator Target ${eventIndex + 1}-${index + 1}`},
            ${`Operator Target ${eventIndex + 1}-${index + 1}`}, 'pending', 0, 'operator'
          ) RETURNING id::integer
        `;
        assert.ok(target);
        event.operatorTargetIds.push(target.id);
      }
    }
  });

  return {
    organizationId,
    operatorEmail,
    operatorPassword,
    events,
    songIds,
  };
}

async function loginOperator(fixture: LoadFixture) {
  const response = await fetch(`${ORIGIN}/api/dashboard/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: fixture.operatorEmail,
      password: fixture.operatorPassword,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await safeJson(response);
  assert.equal(response.status, 200, `Local operator login failed with ${response.status}: ${safeErrorCode(body)}`);
  const jar: CookieJar = new Map();
  for (const value of response.headers.getSetCookie()) {
    const first = value.split(";", 1)[0];
    const separator = first.indexOf("=");
    if (separator > 0) jar.set(first.slice(0, separator), first.slice(separator + 1));
  }
  assert.ok(jar.size > 0, "Local operator login did not return an Auth cookie.");
  return jar;
}

async function warmApplication(fixture: LoadFixture, operatorCookies: CookieJar) {
  for (let index = 0; index < 4; index += 1) {
    const queue = await queueRequest("warmup", fixture.events[0], 9_000 + index, "control");
    assert.equal(queue.status, 200);
  }
  const response = await fetch(
    `${ORIGIN}/api/dashboard/organizations/${fixture.organizationId}/events/${fixture.events[0].publicId}/queue`,
    {
      headers: { cookie: cookieHeader(operatorCookies) },
      signal: AbortSignal.timeout(12_000),
    },
  );
  assert.equal(response.status, 200, "Authenticated operator queue warmup failed.");
  await response.arrayBuffer();
}

function queueRequest(
  label: string,
  event: EventFixture,
  clientIndex: number,
  group: RequestGroup,
) {
  return measuredFetch({
    id: `${label}-queue-${clientIndex}`,
    kind: "queue",
    group,
    url: `${ORIGIN}/api/s/${event.publicToken}/queue`,
    headers: clientHeaders(clientIndex),
    expectedStatus: 200,
    validate: (body) =>
      isRecord(body) &&
      body.enabled === true &&
      body.showSongTitles === true &&
      Array.isArray(body.items),
  });
}

function mineRequest(
  label: string,
  event: EventFixture,
  client: ClientFixture,
  clientIndex: number,
  group: RequestGroup,
) {
  return measuredFetch({
    id: `${label}-mine-${clientIndex}`,
    kind: "mine",
    group,
    url: `${ORIGIN}/api/s/${event.publicToken}/requests/mine`,
    headers: {
      ...clientHeaders(clientIndex),
      cookie: `poza_nuta_participant=${client.credential}`,
    },
    expectedStatus: 200,
    validate: (body) => isRecord(body) && Array.isArray(body.items),
  });
}

function createRequest(
  label: string,
  event: EventFixture,
  client: ClientFixture,
  songId: number,
  clientIndex: number,
  group: RequestGroup,
) {
  return measuredFetch({
    id: `${label}-create-${clientIndex}`,
    kind: "create",
    group,
    url: `${ORIGIN}/api/s/${event.publicToken}/requests`,
    method: "POST",
    headers: {
      ...clientHeaders(clientIndex),
      cookie: `poza_nuta_participant=${client.credential}`,
      "content-type": "application/json",
      origin: ORIGIN,
    },
    body: JSON.stringify({ songId }),
    expectedStatus: 201,
    validate: (body) =>
      isRecord(body) &&
      isRecord(body.request) &&
      typeof body.request.id === "string" &&
      body.request.status === "pending",
    getCreatedRequestId: (body) =>
      isRecord(body) && isRecord(body.request) && typeof body.request.id === "string"
        ? body.request.id
        : null,
    songId,
  });
}

function operatorActionRequest(
  label: string,
  organizationId: string,
  event: EventFixture,
  requestId: number,
  cookies: CookieJar,
) {
  return measuredFetch({
    id: `${label}-operator-${requestId}`,
    kind: "operator",
    group: "all",
    url: `${ORIGIN}/api/dashboard/organizations/${organizationId}/events/${event.publicId}/queue/requests/${requestId}/action`,
    method: "POST",
    headers: {
      cookie: cookieHeader(cookies),
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "approve" }),
    expectedStatus: 200,
    validate: (body) =>
      isRecord(body) && isRecord(body.request) && body.request.status === "approved",
  });
}

async function measuredFetch(input: {
  id: string;
  kind: RequestKind;
  group: RequestGroup;
  url: string;
  method?: "GET" | "POST";
  headers?: HeadersInit;
  body?: string;
  expectedStatus: number;
  validate(body: unknown): boolean;
  getCreatedRequestId?(body: unknown): string | null;
  songId?: number;
}): Promise<MeasuredRequest> {
  const started = performance.now();
  try {
    const response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers: input.headers,
      body: input.body,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const body = await safeJson(response);
    return {
      id: input.id,
      kind: input.kind,
      group: input.group,
      latencyMs: performance.now() - started,
      status: response.status,
      errorCode: safeErrorCode(body),
      semanticOk: response.status === input.expectedStatus && input.validate(body),
      clientError: null,
      createdRequestId: input.getCreatedRequestId?.(body) ?? null,
      songId: input.songId ?? null,
    };
  } catch (error) {
    return {
      id: input.id,
      kind: input.kind,
      group: input.group,
      latencyMs: performance.now() - started,
      status: null,
      errorCode: null,
      semanticOk: false,
      clientError: error instanceof Error ? error.name : "UnknownError",
      createdRequestId: null,
      songId: input.songId ?? null,
    };
  }
}

async function runBurst(label: string, tasks: RequestTask[]) {
  const started = performance.now();
  const results = await withScenarioDeadline(
    Promise.all(tasks.map((task) => task())),
    label,
  );
  return { results, durationMs: performance.now() - started };
}

function summarizeOperations(results: MeasuredRequest[]) {
  const operations: Record<string, RequestSummary> = {};
  for (const kind of ["queue", "mine", "create", "operator"] as const) {
    const matching = results.filter((result) => result.kind === kind);
    if (matching.length > 0) {
      operations[kind] = summarizeRequests(matching, groupDuration(matching));
    }
  }
  return operations;
}

async function withScenarioDeadline<T>(promise: Promise<T>, label: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded the ${SCENARIO_TIMEOUT_MS}ms scenario deadline.`)),
          SCENARIO_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function summarizeRequests(results: MeasuredRequest[], durationMs: number): RequestSummary {
  const latencies = results.map((result) => result.latencyMs);
  const errors = new Map<string, number>();
  let successes = 0;
  let expectedConflicts = 0;
  let unexpected4xx = 0;
  let serverErrors = 0;
  let clientErrors = 0;
  let semanticFailures = 0;

  for (const result of results) {
    if (result.clientError) {
      clientErrors += 1;
      increment(errors, result.clientError);
      continue;
    }
    if (result.status !== null && result.status >= 500) serverErrors += 1;
    else if (result.status === 409 && result.errorCode === "SESSION_REQUEST_DUPLICATE") {
      expectedConflicts += 1;
    } else if (result.status !== null && result.status >= 400) unexpected4xx += 1;
    else if (result.semanticOk) successes += 1;
    else semanticFailures += 1;
    if (result.errorCode) increment(errors, result.errorCode);
  }

  return {
    totalRequests: results.length,
    successes,
    expectedConflicts,
    unexpected4xx,
    serverErrors,
    clientErrors,
    semanticFailures,
    durationMs: round(durationMs),
    requestsPerSecond: durationMs > 0 ? round(results.length / (durationMs / 1_000)) : 0,
    errorCodes: Object.fromEntries([...errors.entries()].sort()),
    ...latencySummary(latencies),
  };
}

function latencySummary(values: number[]): LatencySummary {
  if (values.length === 0) return { p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

function percentile(sorted: number[], percentileValue: number) {
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

function groupDuration(results: MeasuredRequest[]) {
  return results.length === 0 ? 0 : Math.max(...results.map((result) => result.latencyMs));
}

async function checkCreateInvariants(
  sql: postgres.Sql,
  event: EventFixture,
  attempted: number,
  results: MeasuredRequest[],
): Promise<InvariantResult> {
  const successfulIds = results
    .filter((result) => result.semanticOk && result.createdRequestId)
    .map((result) => result.createdRequestId as string);
  const attemptedSongIds = results
    .map((result) => result.songId)
    .filter((value): value is number => typeof value === "number");
  const rows = attemptedSongIds.length === 0
    ? []
    : await sql<{ public_id: string; song_id: number; position: number; status: string }[]>`
        SELECT public_id::text, song_id::integer, position::integer, status::text
        FROM public.song_requests
        WHERE event_id = ${event.id}
          AND song_id = ANY(${attemptedSongIds}::bigint[])
        ORDER BY position, id
      `;
  const [globalState] = await sql<{
    duplicate_positive_positions: number;
    impossible_statuses: number;
  }[]>`
    SELECT
      (
        SELECT count(*)::integer
        FROM (
          SELECT position
          FROM public.song_requests
          WHERE event_id = ${event.id} AND position > 0
          GROUP BY status, position
          HAVING count(*) > 1
        ) duplicates
      ) AS duplicate_positive_positions,
      count(*) FILTER (
        WHERE status::text NOT IN ('pending', 'approved', 'now', 'done', 'skipped', 'rejected')
      )::integer AS impossible_statuses
    FROM public.song_requests
    WHERE event_id = ${event.id}
  `;
  assert.ok(globalState);
  const positions = rows.map((row) => row.position).sort((left, right) => left - right);
  const nonContiguousCreatedPositions =
    positions.length > 1 && positions[positions.length - 1] - positions[0] + 1 !== positions.length;
  const storedSuccessfulRequests = rows.filter((row) => successfulIds.includes(row.public_id)).length;
  const unexpectedStoredRequests = rows.length - storedSuccessfulRequests;
  const [deadlockState] = await sql<{ deadlocks: number }[]>`
    SELECT deadlocks::integer
    FROM pg_stat_database
    WHERE datname = current_database()
  `;
  return {
    attempted,
    successfulResponses: successfulIds.length,
    storedSuccessfulRequests,
    missingSuccessfulRequests: successfulIds.length - storedSuccessfulRequests,
    unexpectedStoredRequests,
    duplicatePositivePositions: globalState.duplicate_positive_positions,
    nonContiguousCreatedPositions,
    impossibleStatuses: globalState.impossible_statuses,
    deadlocksObserved: deadlockState?.deadlocks ?? 0,
  };
}

async function deleteCreatedRequests(sql: postgres.Sql, results: MeasuredRequest[]) {
  const ids = results
    .map((result) => result.createdRequestId)
    .filter((value): value is string => typeof value === "string");
  if (ids.length === 0) return;
  await sql`
    DELETE FROM public.song_requests
    WHERE public_id::text = ANY(${ids}::text[])
  `;
}

async function recover(
  sql: postgres.Sql,
  event: EventFixture,
  label: string,
): Promise<RecoveryResult> {
  await delay(200);
  const activity = await readActivity(sql);
  const control = await queueRequest(label, event, 12_000 + Math.floor(Math.random() * 1_000), "control");
  return {
    activity,
    controlRequest: summarizeRequests([control], control.latencyMs),
  };
}

async function readActivity(sql: postgres.Sql): Promise<ActivitySnapshot> {
  const [row] = await sql<{
    total_connections: number;
    idle_connections: number;
    active_queries: number;
    idle_in_transaction: number;
    lock_waiters: number;
    blocked_backends: number;
  }[]>`
    SELECT
      count(*)::integer AS total_connections,
      count(*) FILTER (WHERE state = 'idle')::integer AS idle_connections,
      count(*) FILTER (WHERE state = 'active' AND pid <> pg_backend_pid())::integer AS active_queries,
      count(*) FILTER (WHERE state IN ('idle in transaction', 'idle in transaction (aborted)'))::integer AS idle_in_transaction,
      count(*) FILTER (WHERE wait_event_type = 'Lock')::integer AS lock_waiters,
      count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid)) > 0)::integer AS blocked_backends
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND backend_type = 'client backend'
      AND pid <> pg_backend_pid()
  `;
  assert.ok(row);
  return {
    totalConnections: row.total_connections,
    idleConnections: row.idle_connections,
    activeQueries: row.active_queries,
    idleInTransaction: row.idle_in_transaction,
    lockWaiters: row.lock_waiters,
    blockedBackends: row.blocked_backends,
  };
}

async function holdQueueMutex(sessionId: number) {
  const databaseUrl = localDatabaseUrl;
  assert.ok(databaseUrl, "DATABASE_URL is unavailable to the lock fixture.");
  const blockerSql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    prepare: false,
  });
  const locked = deferred<number>();
  const releaseSignal = deferred<void>();
  let released = false;
  const done = blockerSql.begin(async (transaction) => {
    const [backend] = await transaction<{ pid: number }[]>`
      SELECT pg_backend_pid()::integer AS pid
    `;
    assert.ok(backend);
    await transaction`
      SELECT id
      FROM public.event_sessions
      WHERE id = ${sessionId}
      FOR UPDATE
    `;
    locked.resolve(backend.pid);
    await releaseSignal.promise;
  }).finally(() => blockerSql.end({ timeout: 5 }));
  const pid = await locked.promise;
  return {
    pid,
    done,
    release() {
      if (released) return;
      released = true;
      releaseSignal.resolve();
    },
  };
}

async function waitForBlockedWaiters(
  sql: postgres.Sql,
  blockerPid: number,
  expected: number,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let peak = 0;
  while (Date.now() < deadline) {
    const [row] = await sql<{ waiters: number }[]>`
      SELECT count(*)::integer AS waiters
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND ${blockerPid} = ANY(pg_blocking_pids(pid))
    `;
    peak = Math.max(peak, row?.waiters ?? 0);
    if (peak >= expected) return peak;
    await delay(20);
  }
  return peak;
}

function telemetryCursor(next: NextProcess): TelemetryCursor {
  return { db: next.dbTelemetry.length, server: next.serverFailures.length };
}

function countDbErrors(next: NextProcess, cursor: TelemetryCursor) {
  const counts = Object.fromEntries(ERROR_CLASSES.map((value) => [value, 0])) as Record<ErrorClass, number>;
  const seen = new Set<string>();
  for (const entry of next.dbTelemetry.slice(cursor.db)) {
    if (!entry.error_class || !isErrorClass(entry.error_class)) continue;
    if (!entry.phase || !["failure", "rollback", "transaction_attempt_failure", "for_update_select_failure"].includes(entry.phase)) continue;
    const key = `${entry.request_id ?? "unknown"}:${entry.error_class}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[entry.error_class] += 1;
  }
  for (const entry of next.serverFailures.slice(cursor.server)) {
    if (!isErrorClass(entry.errorClass)) continue;
    const key = `${entry.requestId}:${entry.errorClass}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[entry.errorClass] += 1;
  }
  return counts;
}

function aggregateRuns(runs: ScenarioRun[]): RepeatAggregate {
  assert.ok(runs.length > 0);
  const metricMedian = (selector: (run: ScenarioRun) => number) =>
    round(median(runs.map(selector)));
  const dbErrors = Object.fromEntries(ERROR_CLASSES.map((value) => [value, 0])) as Record<ErrorClass, number>;
  for (const run of runs) {
    for (const errorClass of ERROR_CLASSES) dbErrors[errorClass] += run.dbErrors[errorClass];
  }
  return {
    runs: runs.length,
    median: {
      p50Ms: metricMedian((run) => run.summary.p50Ms),
      p95Ms: metricMedian((run) => run.summary.p95Ms),
      p99Ms: metricMedian((run) => run.summary.p99Ms),
      maxMs: metricMedian((run) => run.summary.maxMs),
      durationMs: metricMedian((run) => run.summary.durationMs),
      requestsPerSecond: metricMedian((run) => run.summary.requestsPerSecond),
    },
    worstP95Ms: Math.max(...runs.map((run) => run.summary.p95Ms)),
    worstMaxMs: Math.max(...runs.map((run) => run.summary.maxMs)),
    errorsAcrossRuns: {
      expectedConflicts: sum(runs.map((run) => run.summary.expectedConflicts)),
      unexpected4xx: sum(runs.map((run) => run.summary.unexpected4xx)),
      serverErrors: sum(runs.map((run) => run.summary.serverErrors)),
      clientErrors: sum(runs.map((run) => run.summary.clientErrors)),
      semanticFailures: sum(runs.map((run) => run.summary.semanticFailures)),
      dbErrors,
    },
  };
}

function compactReport(report: {
  smoke: ScenarioRun;
  scenarioA: Record<string, ScenarioRun[]>;
  scenarioAAggregate100: RepeatAggregate;
  scenarioB: Record<string, ScenarioRun[]>;
  scenarioC: Record<string, ScenarioRun[]>;
  scenarioCAggregate100: RepeatAggregate;
  scenarioD: ScenarioRun[];
  scenarioDAggregate: RepeatAggregate;
  scenarioE: ScenarioRun;
  incidentProbe: ScenarioRun;
  finalActivity: ActivitySnapshot;
}) {
  return {
    smoke: compactRun(report.smoke),
    A: compactLevels(report.scenarioA),
    A100_repeatability: report.scenarioAAggregate100,
    B: compactLevels(report.scenarioB),
    C: compactLevels(report.scenarioC),
    C100_repeatability: report.scenarioCAggregate100,
    D: report.scenarioD.map(compactRun),
    D_repeatability: report.scenarioDAggregate,
    E: compactRun(report.scenarioE),
    incidentProbe: compactRun(report.incidentProbe),
    finalActivity: report.finalActivity,
  };
}

function compactLevels(levels: Record<string, ScenarioRun[]>) {
  return Object.fromEntries(
    Object.entries(levels).map(([level, runs]) => [
      level,
      runs.length === 1 ? compactRun(runs[0]) : aggregateRuns(runs),
    ]),
  );
}

function compactRun(run: ScenarioRun) {
  return {
    summary: run.summary,
    dbErrors: run.dbErrors,
    operations: run.operations,
    groups: run.groups,
    invariants: run.invariants,
    recovery: run.recovery,
    evidence: run.evidence,
  };
}

async function startNextProcess(environment: NodeJS.ProcessEnv): Promise<NextProcess> {
  const child = spawn(
    process.execPath,
    [resolve(repoRoot, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "localhost"],
    {
      cwd: repoRoot,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const result: NextProcess = {
    child,
    dbTelemetry: [],
    serverFailures: [],
    tail: [],
  };
  attachLineReader(child.stdout, (line) => captureNextLine(result, line));
  attachLineReader(child.stderr, (line) => captureNextLine(result, line));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before readiness. ${sanitizeOutput(result.tail.join("\n"))}`);
    }
    try {
      const response = await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        await response.arrayBuffer();
        return result;
      }
    } catch {
      // Retry until the bounded readiness deadline.
    }
    await delay(200);
  }
  throw new Error(`Next.js readiness timed out. ${sanitizeOutput(result.tail.join("\n"))}`);
}

function captureNextLine(next: NextProcess, line: string) {
  if (!line) return;
  next.tail.push(line);
  if (next.tail.length > 80) next.tail.shift();
  const jsonStart = line.indexOf('{"event":"db_telemetry"');
  if (jsonStart >= 0) {
    try {
      next.dbTelemetry.push(JSON.parse(line.slice(jsonStart)) as DbTelemetryEntry);
    } catch {
      // A malformed diagnostic line is retained in the bounded tail for failure diagnosis.
    }
  }
  if (line.includes("server_step") && line.includes("status=failure") && line.includes("error_class=")) {
    const requestId = /request_id="([^"]+)"/.exec(line)?.[1];
    const errorClass = /error_class="([^"]+)"/.exec(line)?.[1];
    if (requestId && errorClass) next.serverFailures.push({ requestId, errorClass });
  }
}

async function stopNextProcess(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
  child.kill("SIGTERM");
  const stopped = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
  if (!stopped && child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

function attachLineReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void) {
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  stream.on("end", () => {
    if (buffer) onLine(buffer);
  });
}

async function runSupabase(args: string[], allowFailure = false) {
  const result = await runCaptured(
    "supabase",
    ["--workdir", projectRoot, "--yes", ...args],
    {
      ...process.env,
      DO_NOT_TRACK: "1",
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
    10 * 60_000,
  );
  if (result.exitCode !== 0 && !allowFailure) {
    throw new Error(`Supabase ${args[0]} failed. ${sanitizeOutput(`${result.stderr}\n${result.stdout}`)}`);
  }
  return result.stdout;
}

async function runCapturedChecked(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  timeoutMs = 120_000,
) {
  const result = await runCaptured(command, args, environment, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args[0]} failed. ${sanitizeOutput(`${result.stderr}\n${result.stdout}`)}`);
  }
  return result.stdout;
}

function runCaptured(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", formatWindowsCommand(command, args)],
          { cwd: repoRoot, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
        )
      : spawn(command, args, {
          cwd: repoRoot,
          env: environment,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function formatWindowsCommand(command: string, args: string[]) {
  return [command, ...args].map(quoteWindowsArgument).join(" ");
}

function quoteWindowsArgument(value: string) {
  return /^[A-Za-z0-9_./\\:@=,+-]+$/.test(value)
    ? value
    : `"${value.replaceAll('"', '""')}"`;
}

function createLocalSupabaseConfig() {
  return `project_id = "${PROJECT_ID}"

[api]
enabled = true
port = ${API_PORT}
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = ${DB_PORT}
shadow_port = ${SHADOW_DB_PORT}
major_version = 17

[db.pooler]
enabled = false

[db.migrations]
enabled = false

[db.seed]
enabled = false

[realtime]
enabled = true

[studio]
enabled = false
port = ${STUDIO_PORT}
api_url = "http://127.0.0.1:${API_PORT}"

[local_smtp]
enabled = false
port = ${MAIL_PORT}

[storage]
enabled = false
file_size_limit = "50MiB"

[auth]
enabled = true
site_url = "${ORIGIN}"
additional_redirect_urls = ["${ORIGIN}/auth/callback"]
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10
enable_signup = true
enable_anonymous_sign_ins = false
minimum_password_length = 8

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
secure_password_change = false
max_frequency = "1s"
otp_length = 6
otp_expiry = 3600

[analytics]
enabled = false
port = ${ANALYTICS_PORT}

[edge_runtime]
enabled = false
`;
}

function assertLocalEphemeralTargets(databaseUrl: string, supabaseUrl: string) {
  const databaseTarget = new URL(databaseUrl);
  const supabaseTarget = new URL(supabaseUrl);
  assert.ok(
    ["postgres:", "postgresql:"].includes(databaseTarget.protocol),
    "Load test refused a non-PostgreSQL DATABASE_URL.",
  );
  assert.equal(databaseTarget.hostname, "127.0.0.1", "Load test DATABASE_URL must use 127.0.0.1.");
  assert.equal(databaseTarget.port, String(DB_PORT), "Load test DATABASE_URL has an unexpected local port.");
  assert.equal(databaseTarget.pathname, "/postgres", "Load test DATABASE_URL must target the ephemeral postgres database.");
  assert.equal(supabaseTarget.protocol, "http:", "Load test Supabase URL must use local HTTP.");
  assert.equal(supabaseTarget.hostname, "127.0.0.1", "Load test Supabase URL must use 127.0.0.1.");
  assert.equal(supabaseTarget.port, String(API_PORT), "Load test Supabase URL has an unexpected local port.");
  assert.notEqual(process.env.VERCEL, "1", "Load test refuses to run inside a Vercel runtime.");
  assert.notEqual(process.env.VERCEL_ENV, "production", "Load test refuses a production Vercel environment.");
}

function assertRealisticHealthy(run: ScenarioRun) {
  assert.equal(run.summary.unexpected4xx, 0, `${run.label} produced unexpected 4xx responses.`);
  assert.equal(run.summary.serverErrors, 0, `${run.label} produced unexpected 5xx responses.`);
  assert.equal(run.summary.clientErrors, 0, `${run.label} produced client errors.`);
  assert.equal(run.summary.semanticFailures, 0, `${run.label} produced semantically invalid responses.`);
  for (const errorClass of ERROR_CLASSES) {
    assert.equal(run.dbErrors[errorClass], 0, `${run.label} produced ${errorClass}.`);
  }
  if (run.invariants) {
    assert.equal(run.invariants.missingSuccessfulRequests, 0, `${run.label} lost a successful create.`);
    assert.equal(run.invariants.unexpectedStoredRequests, 0, `${run.label} committed a failed create.`);
    assert.equal(run.invariants.duplicatePositivePositions, 0, `${run.label} produced duplicate queue positions within a status.`);
    assert.equal(run.invariants.nonContiguousCreatedPositions, false, `${run.label} produced a non-contiguous created sequence.`);
    assert.equal(run.invariants.impossibleStatuses, 0, `${run.label} produced an impossible status.`);
    assert.equal(run.invariants.deadlocksObserved, 0, `${run.label} observed a database deadlock.`);
  }
  assert.equal(run.recovery.activity.idleInTransaction, 0, `${run.label} left idle-in-transaction work.`);
  assert.equal(run.recovery.activity.lockWaiters, 0, `${run.label} left a lock waiter.`);
  assert.equal(run.recovery.activity.blockedBackends, 0, `${run.label} left a blocked backend.`);
  assert.equal(run.recovery.controlRequest.successes, 1, `${run.label} recovery request failed.`);
}

function assertStressIntegrity(run: ScenarioRun) {
  assert.equal(run.summary.expectedConflicts, 0, `${run.label} unexpectedly measured duplicate rejection.`);
  assert.equal(run.summary.unexpected4xx, 0, `${run.label} produced unexpected 4xx responses.`);
  assert.equal(run.summary.clientErrors, 0, `${run.label} produced client errors.`);
  assert.equal(run.summary.semanticFailures, 0, `${run.label} produced semantically invalid responses.`);
  assert.equal(
    run.summary.serverErrors,
    run.dbErrors.DB_LOCK_TIMEOUT,
    `${run.label} had 5xx responses not explained one-for-one by DB_LOCK_TIMEOUT.`,
  );
  for (const errorClass of ERROR_CLASSES.filter((value) => value !== "DB_LOCK_TIMEOUT")) {
    assert.equal(run.dbErrors[errorClass], 0, `${run.label} produced ${errorClass}.`);
  }
  if (run.invariants) {
    assert.equal(
      run.invariants.successfulResponses + run.dbErrors.DB_LOCK_TIMEOUT,
      run.invariants.attempted,
      `${run.label} did not account for every attempted create.`,
    );
    assert.equal(run.invariants.missingSuccessfulRequests, 0, `${run.label} lost a successful create.`);
    assert.equal(run.invariants.unexpectedStoredRequests, 0, `${run.label} committed a failed create.`);
    assert.equal(run.invariants.duplicatePositivePositions, 0, `${run.label} produced duplicate queue positions within a status.`);
    assert.equal(run.invariants.nonContiguousCreatedPositions, false, `${run.label} produced a non-contiguous created sequence.`);
    assert.equal(run.invariants.impossibleStatuses, 0, `${run.label} produced an impossible status.`);
    assert.equal(run.invariants.deadlocksObserved, 0, `${run.label} observed a database deadlock.`);
  }
  assert.equal(run.recovery.activity.idleInTransaction, 0, `${run.label} left idle-in-transaction work.`);
  assert.equal(run.recovery.activity.lockWaiters, 0, `${run.label} left a lock waiter.`);
  assert.equal(run.recovery.activity.blockedBackends, 0, `${run.label} left a blocked backend.`);
  assert.equal(run.recovery.controlRequest.successes, 1, `${run.label} recovery request failed.`);
}

function assertDeliberateLockResult(run: ScenarioRun) {
  assert.equal(run.dbErrors.DB_LOCK_TIMEOUT, 1, "Scenario E did not produce exactly one DB_LOCK_TIMEOUT.");
  assert.equal(run.dbErrors.APP_DEADLINE_EXCEEDED, 0, "Scenario E reached the application deadline.");
  for (const errorClass of ERROR_CLASSES.filter(
    (value) => value !== "DB_LOCK_TIMEOUT" && value !== "APP_DEADLINE_EXCEEDED",
  )) {
    assert.equal(run.dbErrors[errorClass], 0, `Scenario E produced ${errorClass}.`);
  }
  assert.equal(run.groups?.hot.serverErrors, 1, "Scenario E same-event mutation did not fail-fast with 5xx.");
  assert.equal(run.groups?.other.successes, 2, "Scenario E unrelated-event work did not remain healthy.");
  assert.equal(run.groups?.postRelease.successes, 1, "Scenario E did not recover after blocker release.");
  assert.equal(run.recovery.activity.idleInTransaction, 0, "Scenario E left idle-in-transaction work.");
  assert.equal(run.recovery.activity.lockWaiters, 0, "Scenario E left a lock waiter.");
  assert.equal(run.recovery.activity.blockedBackends, 0, "Scenario E left a blocked backend.");
  assert.equal(run.recovery.controlRequest.successes, 1, "Scenario E recovery request failed.");
}

function parseStatusEnvironment(output: string) {
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), stripMatchingQuotes(line.slice(separator + 1))];
      }),
  );
}

function stripMatchingQuotes(value: string) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function requireStatusValue(values: Record<string, string>, key: string) {
  const value = values[key];
  assert.ok(value, `Local Supabase status is missing ${key}.`);
  return value;
}

function sanitizeOutput(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/(?:key|token|secret|password|jwt|db_url|api_url|studio_url)/i.test(line))
    .map((line) => line.replace(/\b(?:https?|postgres(?:ql)?):\/\/\S+/gi, "[redacted-url]"))
    .slice(-8)
    .join(" ");
}

async function assertPortsAvailable(ports: number[]) {
  for (const port of ports) {
    await new Promise<void>((resolvePromise, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", () => reject(new Error(`Required local load-test port ${port} is unavailable.`)));
      server.listen(port, "127.0.0.1", () => server.close(() => resolvePromise()));
    });
  }
}

function clientHeaders(clientIndex: number) {
  const normalized = Math.abs(clientIndex) % 65_000;
  const third = Math.floor(normalized / 250);
  const fourth = (normalized % 250) + 1;
  return {
    "x-forwarded-for": `198.18.${third}.${fourth}`,
    "x-real-ip": `198.18.${third}.${fourth}`,
  };
}

function cookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeErrorCode(value: unknown) {
  return isRecord(value) && isRecord(value.error) && typeof value.error.code === "string"
    ? value.error.code
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorClass(value: string): value is ErrorClass {
  return (ERROR_CLASSES as readonly string[]).includes(value);
}

function takeSong(songIds: number[], cursor: { value: number }) {
  const song = songIds[100 + cursor.value];
  assert.ok(song, "The load fixture exhausted unique song IDs.");
  cursor.value += 1;
  return song;
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function delay(milliseconds: number) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
