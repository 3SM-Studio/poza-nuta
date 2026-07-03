import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicQueueVisibleStatus,
  PUBLIC_QUEUE_VISIBLE_STATUSES,
} from "../src/server/public-api/queue-policy.ts";
import {
  MAX_NOTE_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_SINGER_NAME_LENGTH,
  normalizeSearchQuery,
  validatePublicRequestInput,
  validateSearchQuery,
} from "../src/server/public-api/validation.ts";

test("validatePublicRequestInput trims and accepts valid input", () => {
  const result = validatePublicRequestInput({
    songId: 42,
    singerName: "  Alicja  ",
    note: "  Proszę niżej tonację  ",
  });

  assert.deepEqual(result, {
    success: true,
    data: {
      songId: 42,
      singerName: "Alicja",
      note: "Proszę niżej tonację",
    },
  });
});

test("validatePublicRequestInput rejects invalid identifiers and limits", () => {
  const result = validatePublicRequestInput({
    songId: "42",
    singerName: "a".repeat(MAX_SINGER_NAME_LENGTH + 1),
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.success ? [] : result.issues.map((issue) => issue.field),
    ["songId", "singerName"],
  );
});

test("validatePublicRequestInput rejects note longer than 300 characters", () => {
  const result = validatePublicRequestInput({
    songId: 42,
    singerName: "Alicja",
    note: "a".repeat(MAX_NOTE_LENGTH + 1),
  });

  assert.deepEqual(result, {
    success: false,
    issues: [
      {
        field: "note",
        message: "note must contain at most 300 characters.",
      },
    ],
  });
});

test("validateSearchQuery returns no query for short public searches", () => {
  assert.deepEqual(validateSearchQuery(" a "), {
    success: true,
    data: null,
  });
});

test("validateSearchQuery rejects excessively long queries", () => {
  const result = validateSearchQuery("a".repeat(MAX_SEARCH_QUERY_LENGTH + 1));

  assert.equal(result.success, false);
});

test("normalizeSearchQuery normalizes case, diacritics and whitespace", () => {
  assert.equal(normalizeSearchQuery("  ŻÓŁĆ   Queen  "), "zolc queen");
});

test("public queue exposes only approved and now statuses", () => {
  assert.deepEqual(PUBLIC_QUEUE_VISIBLE_STATUSES, ["approved", "now"]);
  assert.equal(isPublicQueueVisibleStatus("approved"), true);
  assert.equal(isPublicQueueVisibleStatus("now"), true);
  assert.equal(isPublicQueueVisibleStatus("pending"), false);
  assert.equal(isPublicQueueVisibleStatus("done"), false);
});
