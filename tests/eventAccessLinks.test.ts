import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  generateEventAccessCode,
  hashEventAccessCode,
} from "../src/server/operator-api/crypto.ts";
import {
  MAX_EVENT_ACCESS_LINK_LABEL_LENGTH,
  normalizeEventAccessLinkLabel,
  validateAccessLinkId,
  validateCreateEventAccessLinkInput,
} from "../src/server/operator-api/validation.ts";

test("event access codes have a stable URL-safe format and high entropy", () => {
  const codes = Array.from({ length: 128 }, () => generateEventAccessCode());

  assert.equal(new Set(codes).size, codes.length);

  for (const code of codes) {
    assert.match(code, /^[A-Za-z0-9_-]{32}$/);
    assert.ok(code.length >= 16);
    assert.doesNotMatch(code, /^\d{6}$/);
    assert.equal(Buffer.from(code, "base64url").length, 24);
  }
});

test("event access code hashing is deterministic and hides plaintext", () => {
  const code = generateEventAccessCode();
  const hash = hashEventAccessCode(code);

  assert.equal(hashEventAccessCode(code), hash);
  assert.notEqual(hash, code);
  assert.equal(hash.includes(code), false);
  assert.match(hash, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(hashEventAccessCode(generateEventAccessCode()), hash);
});

test("event access links are stored hash-only in the schema", () => {
  const migrationSource = readFileSync(
    new URL("../drizzle/0003_event_access_links.sql", import.meta.url),
    "utf8",
  );
  const schemaSource = readFileSync(
    new URL("../src/db/schema.ts", import.meta.url),
    "utf8",
  );
  const eventAccessLinksSchema = schemaSource.slice(
    schemaSource.indexOf("export const eventAccessLinks = pgTable("),
    schemaSource.indexOf("export const songRequests = pgTable("),
  );

  assert.match(migrationSource, /"code_hash" text NOT NULL/);
  assert.doesNotMatch(migrationSource, /"code"\s+text/i);
  assert.match(eventAccessLinksSchema, /codeHash: text\("code_hash"\)\.notNull\(\)/);
  assert.doesNotMatch(eventAccessLinksSchema, /code: text\("code"\)/);
});

test("event access link labels are normalized and validated", () => {
  assert.equal(normalizeEventAccessLinkLabel("  Scena główna  "), "Scena główna");
  assert.equal(normalizeEventAccessLinkLabel("   "), null);
  assert.deepEqual(validateCreateEventAccessLinkInput({}), {
    success: true,
    data: { label: null },
  });
  assert.deepEqual(
    validateCreateEventAccessLinkInput({ label: "  Wejście A  " }),
    {
      success: true,
      data: { label: "Wejście A" },
    },
  );
  assert.equal(
    validateCreateEventAccessLinkInput({ label: 42 }).success,
    false,
  );
  assert.equal(
    validateCreateEventAccessLinkInput({
      label: "x".repeat(MAX_EVENT_ACCESS_LINK_LABEL_LENGTH + 1),
    }).success,
    false,
  );
});

test("access link ids accept only safe positive integers", () => {
  assert.deepEqual(validateAccessLinkId("42"), {
    success: true,
    data: 42,
  });
  assert.equal(validateAccessLinkId("0").success, false);
  assert.equal(validateAccessLinkId("-1").success, false);
  assert.equal(validateAccessLinkId("1.5").success, false);
  assert.equal(validateAccessLinkId("not-an-id").success, false);
  assert.equal(
    validateAccessLinkId(String(Number.MAX_SAFE_INTEGER + 1)).success,
    false,
  );
});
