import assert from "node:assert/strict";
import test from "node:test";

import {
  databaseClientOptions,
  DATABASE_MAX_CONNECTIONS,
  DATABASE_STATEMENT_TIMEOUT_MS,
} from "../src/server/db-client-options.ts";
import {
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
  assert.equal(SERVER_STEP_TIMEOUT_MS < DATABASE_STATEMENT_TIMEOUT_MS, true);
  assert.equal(
    databaseClientOptions.connection.statement_timeout,
    DATABASE_STATEMENT_TIMEOUT_MS,
  );
  assert.equal(
    databaseClientOptions.connection.idle_in_transaction_session_timeout,
    DATABASE_STATEMENT_TIMEOUT_MS,
  );
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
