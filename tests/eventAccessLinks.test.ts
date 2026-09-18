import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  isCanonicalSessionCode,
  normalizeSessionCode,
} from "../src/lib/session-code.ts";

test("canonical session codes preserve a leading zero", () => {
  assert.equal(isCanonicalSessionCode("000042"), true);
  assert.equal(isCanonicalSessionCode("42"), false);
  assert.equal(isCanonicalSessionCode("00000042"), false);
});

test("session code validation accepts exactly six ASCII digits", () => {
  for (const code of ["000000", "000001", "004271", "999999"]) {
    assert.equal(isCanonicalSessionCode(code), true, code);
  }
  for (const code of [
    "12345",
    "1234567",
    "12345678",
    "123456789",
    "abcdef",
    "12 3456",
    "１２３４５６",
  ]) {
    assert.equal(isCanonicalSessionCode(code), false, code);
  }
});

test("session code normalization trims only external whitespace", () => {
  assert.equal(normalizeSessionCode("  004271  "), "004271");
  assert.equal(normalizeSessionCode("00 4271"), "00 4271");
  assert.equal(normalizeSessionCode("00-4271"), "00-4271");
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
