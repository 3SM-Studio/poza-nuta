import assert from "node:assert/strict";
import test from "node:test";
import { runWithDbTelemetry, traceDbOperation, traceDbTransaction, traceForUpdateSelect } from "../src/server/db-telemetry.ts";
import { publicApiErrorResponse } from "../src/server/public-api/responses.ts";

import {
  databaseClientOptions,
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DATABASE_LOCK_TIMEOUT_MS,
  DATABASE_MAX_CONNECTIONS,
  DATABASE_STATEMENT_TIMEOUT_MS,
} from "../src/server/db-client-options.ts";
import {
  getSafeErrorCode,
  getSafeErrorMessage,
  classifyDatabaseError,
  isInfrastructureTimeout,
  isTransientInfrastructureError,
  SERVER_STEP_TIMEOUT_MS,
  ServerStepTimeoutError,
  traceServerStepWithoutTimeout,
  withRuntimeDiagnostics,
} from "../src/server/runtime-diagnostics.ts";

test("database client uses serverless-safe Postgres options", () => {
  assert.equal(DATABASE_MAX_CONNECTIONS, 2);
  assert.equal(DATABASE_MAX_CONNECTIONS <= 2, true);
  assert.equal(databaseClientOptions.max, DATABASE_MAX_CONNECTIONS);
  assert.equal(databaseClientOptions.prepare, false);
  assert.equal(databaseClientOptions.connect_timeout, 5);
  assert.equal(databaseClientOptions.idle_timeout, 20);
  assert.equal(DATABASE_LOCK_TIMEOUT_MS < DATABASE_STATEMENT_TIMEOUT_MS, true);
  assert.equal(DATABASE_STATEMENT_TIMEOUT_MS < DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS, true);
  assert.equal(DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS < SERVER_STEP_TIMEOUT_MS, true);
  assert.equal(
    databaseClientOptions.connection.statement_timeout,
    DATABASE_STATEMENT_TIMEOUT_MS,
  );
  assert.equal(
    databaseClientOptions.connection.idle_in_transaction_session_timeout,
    DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  );
});

test("database error classes require evidence from the driver", () => {
  assert.equal(classifyDatabaseError(Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" })), "DB_LOCK_TIMEOUT");
  assert.equal(classifyDatabaseError(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })), "DB_STATEMENT_TIMEOUT");
  assert.equal(classifyDatabaseError(Object.assign(new Error("connect timeout"), { code: "CONNECT_TIMEOUT" })), "DB_CONNECT_TIMEOUT");
  assert.equal(classifyDatabaseError(Object.assign(new Error("connection closed"), { code: "ECONNRESET" })), "DB_CONNECTION_CLOSED");
  assert.equal(classifyDatabaseError(new ServerStepTimeoutError("route", "step", 1)), "APP_DEADLINE_EXCEEDED");
  assert.equal(classifyDatabaseError(Object.assign(new Error("query canceled"), { code: "57014" })), "UNKNOWN_DB_ERROR");
  assert.equal(isInfrastructureTimeout(Object.assign(new Error("lock unavailable"), { code: "55P03" })), true);
});

test("database telemetry correlates phases without logging personal data or driver messages", async () => {
  const originalInfo = console.info;
  const logs: string[] = [];
  console.info = (message?: unknown) => logs.push(String(message));
  try {
    await runWithDbTelemetry("test.route", async () => {
      await traceDbTransaction("ignored.route", "queue.request.create", async (onStarted) => {
        onStarted();
        await traceForUpdateSelect("ignored.route", "public_session.lock", "event", async () => [1]);
        await traceDbOperation("ignored.route", "queue.request.insert", async () => 1);
      });
      await assert.rejects(
        traceDbOperation("ignored.route", "participant.lookup", async () => {
          throw Object.assign(new Error("DATABASE_URL=postgres://user:secret@host/db email@example.com nickname and private search phrase"), { code: "XX000" });
        }),
      );
      await assert.rejects(
        traceDbTransaction("ignored.route", "queue.request.cancel", async (onStarted) => {
          onStarted();
          throw new Error("nickname and private search phrase");
        }),
      );
    });
  } finally {
    console.info = originalInfo;
  }
  const entries = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.ok(entries.some((entry) => entry.phase === "transaction_start"));
  assert.ok(entries.some((entry) => entry.phase === "commit" && typeof entry.transaction_duration_ms === "number"));
  assert.ok(entries.some((entry) => entry.phase === "rollback" && typeof entry.transaction_duration_ms === "number"));
  assert.ok(entries.some((entry) => entry.phase === "lock_acquired" && typeof entry.for_update_select_ms === "number"));
  assert.ok(entries.some((entry) => entry.phase === "failure" && entry.error_class === "UNKNOWN_DB_ERROR"));
  assert.equal(new Set(entries.map((entry) => entry.request_id)).size, 1);
  assert.equal(new Set(entries.map((entry) => entry.runtime_id)).size, 1);
  assert.ok(entries.every((entry) => entry.route === "test.route"));
  assert.doesNotMatch(logs.join("\n"), /secret|email@example|nickname|private search phrase|postgres:\/\//);
});

test("runtime diagnostics identify nested Session Pooler exhaustion safely", () => {
  const directFailure = Object.assign(new Error("Session capacity exhausted"), {
    code: "EMAXCONNSESSION",
  });
  const nestedFailure = Object.assign(
    new Error("EMAXCONNSESSION: max clients in session mode reached secret-host"),
    { code: "XX000" },
  );
  const failure = new Error("Failed query: select sensitive_business_data", {
    cause: nestedFailure,
  });
  const cyclicFailure = new Error("Outer database failure", { cause: failure });
  Object.assign(nestedFailure, { cause: cyclicFailure });

  assert.equal(isTransientInfrastructureError(directFailure), true);
  assert.equal(getSafeErrorCode(directFailure), "EMAXCONNSESSION");
  assert.equal(isTransientInfrastructureError(failure), true);
  assert.equal(getSafeErrorCode(failure), "EMAXCONNSESSION");
  assert.equal(isTransientInfrastructureError(cyclicFailure), true);
  assert.equal(getSafeErrorCode(cyclicFailure), "EMAXCONNSESSION");
  assert.equal(
    getSafeErrorMessage(failure),
    "Database connection capacity exhausted.",
  );
  assert.equal(getSafeErrorMessage(failure).includes("secret-host"), false);
  assert.equal(getSafeErrorMessage(failure).includes("select"), false);
});

test("runtime diagnostics can log an aggregate step without adding a timeout race", async () => {
  const originalInfo = console.info;
  const logs: string[] = [];

  console.info = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const result = await traceServerStepWithoutTimeout(
      "dashboard.session",
      "getSession",
      async () => "ok",
    );

    assert.equal(result, "ok");
    assert.equal(logs.length, 1);
    assert.match(logs[0], /route="dashboard\.session"/);
    assert.match(logs[0], /step="getSession"/);
    assert.match(logs[0], /status=success/);
  } finally {
    console.info = originalInfo;
  }
});

test("runtime diagnostics classify timeout and Postgres statement timeout errors", () => {
  assert.equal(
    isInfrastructureTimeout(
      Object.assign(new Error("query canceled"), {
        code: "57014",
      }),
    ),
    true,
  );
  assert.equal(
    isInfrastructureTimeout(
      new Error("canceling statement due to statement timeout"),
    ),
    true,
  );
  assert.equal(
    isTransientInfrastructureError(
      new ServerStepTimeoutError("dashboard.me", "findLinkedOperator", 10),
    ),
    true,
  );
  assert.equal(
    isTransientInfrastructureError(
      Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "57014",
      }),
    ),
    true,
  );
  assert.equal(
    isInfrastructureTimeout(new Error("business timeout window expired")),
    false,
  );
  assert.equal(isTransientInfrastructureError(new Error("validation failed")), false);
});

test("nested message-only timeout remains HTTP 500 while telemetry classifies its cause safely", async () => {
  const nested = Object.assign(
    new Error("connect timeout DATABASE_URL=postgres://fake-user:fake-password@fake-host/db Bearer fake-token email@example.test"),
    { code: "XX000" },
  );
  const failure = new Error("Failed query", { cause: nested });
  assert.equal(isInfrastructureTimeout(failure), false);
  assert.equal(isTransientInfrastructureError(failure), false);
  assert.equal(classifyDatabaseError(failure), "DB_CONNECT_TIMEOUT");

  const originalWarn = console.warn;
  const originalError = console.error;
  const logs: string[] = [];
  console.warn = (message?: unknown) => { logs.push(String(message)); };
  console.error = (message?: unknown) => { logs.push(String(message)); };
  try {
    await assert.rejects(
      withRuntimeDiagnostics("test.route", "nestedDbFailure", async () => { throw failure; }, 100),
      failure,
    );
    const response = publicApiErrorResponse(failure);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
    });
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.ok(logs.some((line) => line.includes('error_class="DB_CONNECT_TIMEOUT"')));
  assert.doesNotMatch(logs.join("\n"), /fake-password|fake-token|email@example|postgres:\/\//);
});

test("runtime diagnostics observe late promise rejection after timeout", async () => {
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  const originalWarn = console.warn;

  process.on("unhandledRejection", onUnhandledRejection);
  console.warn = () => {};

  try {
    await assert.rejects(
      withRuntimeDiagnostics(
        "test.route",
        "lateRejectingStep",
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("late database failure")), 20);
          }),
        1,
      ),
      ServerStepTimeoutError,
    );

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    assert.deepEqual(unhandledRejections, []);
  } finally {
    console.warn = originalWarn;
    process.off("unhandledRejection", onUnhandledRejection);
  }
});
