import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicQueueVisibleStatus,
  PUBLIC_QUEUE_VISIBLE_STATUSES,
} from "../src/server/public-api/queue-policy.ts";
import {
  MAX_SEARCH_QUERY_LENGTH,
  normalizeSearchQuery,
  validateSearchQuery,
} from "../src/server/public-api/validation.ts";

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
