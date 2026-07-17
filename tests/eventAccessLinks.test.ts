import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  generateCanonicalSessionCode,
  isCanonicalSessionCode,
  normalizeSessionCode,
  withSessionCodeCollisionRetry,
} from "../src/lib/session-code.ts";
import { isSessionCodeUniqueViolation } from "../src/lib/session-code-db-error.ts";

test("canonical session codes are unique eight-digit strings", () => {
  const codes = Array.from({ length: 128 }, () =>
    generateCanonicalSessionCode(),
  );

  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^[0-9]{8}$/);
});

test("canonical session codes preserve a leading zero", () => {
  assert.equal(generateCanonicalSessionCode(() => 42), "00000042");
  assert.equal(isCanonicalSessionCode("00000042"), true);
  assert.equal(isCanonicalSessionCode("42"), false);
});

test("session code paste normalization removes spaces and hyphens only", () => {
  assert.equal(normalizeSessionCode(" 00-00 00-42 "), "00000042");
  assert.equal(normalizeSessionCode("00a00042"), "00a00042");
});

test("session code collisions retry with a bounded attempt count", async () => {
  const generated = ["00000001", "00000002"];
  const attempted: string[] = [];
  const result = await withSessionCodeCollisionRetry(
    async (code) => {
      attempted.push(code);
      if (attempted.length === 1) {
        throw { code: "23505", constraint: "events_session_code_idx" };
      }
      return code;
    },
    isSessionCodeUniqueViolation,
    { attempts: 2, generate: () => generated.shift() ?? "99999999" },
  );

  assert.equal(result, "00000002");
  assert.deepEqual(attempted, ["00000001", "00000002"]);
});

test("session code retry propagates the final collision", async () => {
  await assert.rejects(
    withSessionCodeCollisionRetry(
      async () => {
        throw { code: "23505", constraint_name: "events_session_code_idx" };
      },
      isSessionCodeUniqueViolation,
      { attempts: 2, generate: () => "00000001" },
    ),
    (error: unknown) => isSessionCodeUniqueViolation(error),
  );
});

test("schema stores one required canonical code per event", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const eventsSchema = schema.slice(
    schema.indexOf("export const events = pgTable("),
    schema.indexOf("export const songs = pgTable("),
  );

  assert.match(eventsSchema, /sessionCode: text\("session_code"\)/);
  assert.match(eventsSchema, /events_session_code_idx/);
  assert.match(eventsSchema, /events_session_code_format_check/);
});

test("legacy manual access-link flow is removed from production routes", () => {
  assert.equal(existsSync("src/server/operator-api/access-links-service.ts"), false);
  assert.equal(existsSync("src/components/operator/event-access-links-panel.tsx"), false);
  assert.equal(existsSync("src/components/operator/event-session-link-panel.tsx"), false);
  assert.equal(existsSync("src/app/api/dashboard/event/access-links/route.ts"), false);
  assert.equal(
    existsSync(
      "src/app/api/dashboard/event/access-links/[linkId]/revoke/route.ts",
    ),
    false,
  );
});
