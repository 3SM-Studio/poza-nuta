import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { test, vi } from "vitest";

import {
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DATABASE_LOCK_TIMEOUT_MS,
  DATABASE_STATEMENT_TIMEOUT_MS,
} from "../../src/server/db-client-options.ts";
import { traceDbOperation } from "../../src/server/db-telemetry.ts";
import { setLocalDatabaseTimeouts } from "../../src/server/database-transaction-timeouts.ts";
import { publicApiErrorResponse } from "../../src/server/public-api/responses.ts";
import {
  classifyDatabaseError,
  isInfrastructureTimeout,
  SERVER_STEP_TIMEOUT_MS,
  ServerStepTimeoutError,
  withRuntimeDiagnostics,
} from "../../src/server/runtime-diagnostics.ts";
import {
  applyPostgresMigrations,
  createPostgresTestClient,
  installPostgresCompatibilityFixture,
  removePostgresTestHarness,
  startPostgresTestHarness,
} from "./postgresTestHarness.ts";

vi.mock("server-only", () => ({}));

test("the application deadline remains a final safety net and does not cancel non-DB work", async () => {
  const originalWarn = console.warn;
  const logs: string[] = [];
  let underlyingCompleted = false;
  const underlying = new Promise<string>((resolve) => {
    setTimeout(() => {
      underlyingCompleted = true;
      resolve("completed after deadline");
    }, 30);
  });
  console.warn = (message?: unknown) => { logs.push(String(message)); };

  try {
    const failure = await withRuntimeDiagnostics(
      "timeout.test",
      "nonDbDeadline",
      () => underlying,
      1,
    ).then(() => undefined, (error: unknown) => error);

    assert.ok(failure instanceof ServerStepTimeoutError);
    assert.equal(classifyDatabaseError(failure), "APP_DEADLINE_EXCEEDED");
    assert.equal(underlyingCompleted, false);
    assert.equal(await underlying, "completed after deadline");
    assert.equal(underlyingCompleted, true);
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(logs.some((line) => line.includes('error_class="APP_DEADLINE_EXCEEDED"')));
});

test("a contended public mutation fails with PostgreSQL lock timeout before the application deadline", async () => {
  const harness = await startPostgresTestHarness("pozanuta-db-lock-timeout");
  const observer = createPostgresTestClient(harness, "postgres", 4);
  const blocker = createPostgresTestClient(harness, "postgres", 1);
  const previousUrl = process.env.DATABASE_URL;
  let applicationDatabase: { $client: { end(options: { timeout: number }): Promise<void> } } | undefined;
  const locked = deferred<void>();
  const release = deferred<void>();
  let heldLock: Promise<unknown> | undefined;

  try {
    await installPostgresCompatibilityFixture(observer);
    await applyPostgresMigrations(observer, 24);
    const fixture = await seedPublicSessionFixture(observer);
    process.env.DATABASE_URL = `postgres://postgres:${encodeURIComponent(harness.password)}@${harness.host}:${harness.port}/postgres`;
    const { getDb } = await import("../../src/server/db.ts");
    const sessionService = await import("../../src/server/session-api/service.ts");
    applicationDatabase = getDb() as unknown as typeof applicationDatabase;
    const participant = await sessionService.joinPublicSession(
      fixture.publicToken,
      null,
      { displayName: "Timeout Singer", normalizedDisplayName: "timeout singer" },
    );

    heldLock = blocker.begin(async (transaction) => {
      await transaction`
        SELECT id FROM public.event_sessions
        WHERE id = ${fixture.sessionId}
        FOR NO KEY UPDATE
      `;
      locked.resolve();
      await release.promise;
    });
    void heldLock.catch(() => undefined);
    await withDeadline(locked.promise, "The session lock fixture was not acquired.");

    const logs: string[] = [];
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.info = (message?: unknown) => { logs.push(String(message)); };
    console.warn = (message?: unknown) => { logs.push(String(message)); };
    console.error = (message?: unknown) => { logs.push(String(message)); };
    const started = performance.now();
    let failure: unknown;
    try {
      failure = await withRuntimeDiagnostics(
        "timeout.test",
        "createPublicSessionRequest",
        () => sessionService.createPublicSessionRequest(
          fixture.publicToken,
          participant.credential,
          { songId: fixture.songId },
        ),
      ).then(() => undefined, (error: unknown) => error);
    } finally {
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
    }
    const elapsedMs = performance.now() - started;

    assert.ok(failure);
    assert.equal(failure instanceof ServerStepTimeoutError, false);
    assert.equal(findErrorCode(failure), "55P03");
    assert.equal(classifyDatabaseError(failure), "DB_LOCK_TIMEOUT");
    assert.equal(isInfrastructureTimeout(failure), true);
    const response = publicApiErrorResponse(failure);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The service is temporarily unavailable.",
      },
    });
    assert.ok(elapsedMs >= DATABASE_LOCK_TIMEOUT_MS - 500, `Lock timeout fired too early: ${elapsedMs}ms`);
    assert.ok(elapsedMs < DATABASE_STATEMENT_TIMEOUT_MS, `Lock timeout was masked: ${elapsedMs}ms`);
    assert.match(logs.join("\n"), /DB_LOCK_TIMEOUT/);
    assert.doesNotMatch(logs.join("\n"), /APP_DEADLINE_EXCEEDED/);
    const lockFailure = logs
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.phase === "for_update_select_failure");
    assert.equal(lockFailure?.error_class, "DB_LOCK_TIMEOUT");
    assert.ok(
      typeof lockFailure?.for_update_select_ms === "number" &&
        lockFailure.for_update_select_ms >= DATABASE_LOCK_TIMEOUT_MS - 500,
    );
  } finally {
    release.resolve();
    if (heldLock) await Promise.allSettled([heldLock]);
    if (applicationDatabase) {
      await applicationDatabase.$client.end({ timeout: 5 });
      delete (globalThis as typeof globalThis & { pozaNutaDatabase?: unknown }).pozaNutaDatabase;
    }
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await blocker.end({ timeout: 5 });
    await observer.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
}, 180_000);

test("a long statement is cancelled by PostgreSQL before the application deadline", async () => {
  const harness = await startPostgresTestHarness("pozanuta-db-statement-timeout");
  const client = createPostgresTestClient(harness, "postgres", 1);
  const database = drizzle({ client });
  const logs: string[] = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  let configuredTimeouts:
    | { lock_timeout_ms: number; statement_timeout_ms: number; idle_timeout_ms: number }
    | undefined;

  try {
    console.info = (message?: unknown) => { logs.push(String(message)); };
    console.warn = (message?: unknown) => { logs.push(String(message)); };
    const started = performance.now();
    const failure = await withRuntimeDiagnostics(
      "timeout.test",
      "controlledLongStatement",
      () => database.transaction(async (transaction) => {
        await setLocalDatabaseTimeouts(transaction);
        const [settings] = await transaction.execute<{
          lock_timeout_ms: number;
          statement_timeout_ms: number;
          idle_timeout_ms: number;
        }>(drizzleSql`
          SELECT
            (extract(epoch FROM current_setting('lock_timeout')::interval) * 1000)::integer AS lock_timeout_ms,
            (extract(epoch FROM current_setting('statement_timeout')::interval) * 1000)::integer AS statement_timeout_ms,
            (extract(epoch FROM current_setting('idle_in_transaction_session_timeout')::interval) * 1000)::integer AS idle_timeout_ms
        `);
        configuredTimeouts = settings;
        await traceDbOperation("timeout.test", "controlled.long_statement", () =>
          transaction.execute(drizzleSql`SELECT pg_sleep(10)`),
        );
      }),
    ).then(() => undefined, (error: unknown) => error);
    const elapsedMs = performance.now() - started;

    assert.deepEqual(configuredTimeouts, {
      lock_timeout_ms: DATABASE_LOCK_TIMEOUT_MS,
      statement_timeout_ms: DATABASE_STATEMENT_TIMEOUT_MS,
      idle_timeout_ms: DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    });
    assert.ok(failure);
    assert.equal(failure instanceof ServerStepTimeoutError, false);
    assert.equal(findErrorCode(failure), "57014");
    assert.equal(classifyDatabaseError(failure), "DB_STATEMENT_TIMEOUT");
    assert.ok(
      elapsedMs >= DATABASE_STATEMENT_TIMEOUT_MS - 750,
      `Statement timeout fired too early: ${elapsedMs}ms`,
    );
    assert.ok(elapsedMs < SERVER_STEP_TIMEOUT_MS, `Application deadline won: ${elapsedMs}ms`);
    assert.match(logs.join("\n"), /DB_STATEMENT_TIMEOUT/);
    assert.doesNotMatch(logs.join("\n"), /APP_DEADLINE_EXCEEDED/);

    const [outsideTransaction] = await client<{
      lock_timeout: string;
      statement_timeout: string;
      idle_timeout: string;
      usable: number;
    }[]>`
      SELECT
        current_setting('lock_timeout') AS lock_timeout,
        current_setting('statement_timeout') AS statement_timeout,
        current_setting('idle_in_transaction_session_timeout') AS idle_timeout,
        1::integer AS usable
    `;
    assert.deepEqual(outsideTransaction, {
      lock_timeout: "0",
      statement_timeout: "0",
      idle_timeout: "0",
      usable: 1,
    });
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    await client.end({ timeout: 5 });
    await removePostgresTestHarness(harness.containerName);
  }
}, 180_000);

async function seedPublicSessionFixture(sql: postgres.Sql) {
  const [workspace] = await sql<{ id: number }[]>`
    INSERT INTO public.workspaces (name, handle, public_id)
    VALUES ('Timeout fixture', 'timeout-fixture', 'timeouthierarchy0000')
    RETURNING id::integer
  `;
  const [song] = await sql<{ id: number }[]>`
    INSERT INTO public.songs (
      source, source_song_id, title, artist,
      normalized_title, normalized_artist, search_text
    )
    VALUES (
      'ising', 'timeout-fixture', 'Timeout Song', 'Timeout Artist',
      'timeout song', 'timeout artist', 'timeout song timeout artist'
    )
    RETURNING id::integer
  `;
  const [event] = await sql<{ id: number }[]>`
    INSERT INTO public.events (
      workspace_id, name, starts_at, ends_at, auto_close_at, status,
      is_active_public_event, song_requests_enabled, public_queue_enabled
    )
    VALUES (
      ${workspace.id}, 'Timeout event', now() - interval '1 hour',
      now() + interval '2 hours', now() + interval '2 hours', 'active',
      false, true, true
    )
    RETURNING id::integer
  `;
  const publicToken = randomBytes(16).toString("base64url");
  const [session] = await sql<{ id: number }[]>`
    INSERT INTO public.event_sessions (event_id, public_token)
    VALUES (${event.id}, ${publicToken})
    RETURNING id::integer
  `;
  return { publicToken, sessionId: session.id, songId: song.id };
}

function findErrorCode(error: unknown) {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
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
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 5_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
