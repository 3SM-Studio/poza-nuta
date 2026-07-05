import assert from "node:assert/strict";
import test from "node:test";

import {
  databaseClientOptions,
  DATABASE_MAX_CONNECTIONS,
  DATABASE_STATEMENT_TIMEOUT_MS,
} from "../src/server/db-client-options.ts";
import {
  isTransientInfrastructureError,
  ServerStepTimeoutError,
} from "../src/server/runtime-diagnostics.ts";

test("database client uses serverless-safe Postgres options", () => {
  assert.equal(DATABASE_MAX_CONNECTIONS <= 2, true);
  assert.equal(databaseClientOptions.max, DATABASE_MAX_CONNECTIONS);
  assert.equal(databaseClientOptions.prepare, false);
  assert.equal(databaseClientOptions.connect_timeout, 10);
  assert.equal(databaseClientOptions.idle_timeout, 20);
  assert.equal(
    databaseClientOptions.connection.statement_timeout,
    DATABASE_STATEMENT_TIMEOUT_MS,
  );
  assert.equal(
    databaseClientOptions.connection.idle_in_transaction_session_timeout,
    DATABASE_STATEMENT_TIMEOUT_MS,
  );
});

test("runtime diagnostics classify timeout and Postgres statement timeout errors", () => {
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
  assert.equal(isTransientInfrastructureError(new Error("validation failed")), false);
});
