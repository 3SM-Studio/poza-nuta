import assert from "node:assert/strict";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { getEffectivelyActiveEventCondition } from "../src/db/event-conditions.ts";

test("effective active event condition serializes timestamps for the postgres driver", () => {
  const now = new Date("2026-08-09T11:08:40.415Z");
  const condition = getEffectivelyActiveEventCondition(now);
  assert.ok(condition);

  const query = new PgDialect().sqlToQuery(condition);

  assert.equal(query.params.some((param) => param instanceof Date), false);
  assert.deepEqual(query.params, [
    "closed",
    "cancelled",
    now.toISOString(),
    now.toISOString(),
  ]);
  assert.match(query.sql, /coalesce\([^)]*\) > \$4::timestamptz/);
});
