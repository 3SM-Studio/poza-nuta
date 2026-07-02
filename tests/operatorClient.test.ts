import assert from "node:assert/strict";
import test from "node:test";

import { formatDuration } from "../components/operator/api.ts";

test("formatDuration formats queue durations for the operator UI", () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3_605), "60:05");
});
