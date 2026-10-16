import assert from "node:assert/strict";
import { test } from "node:test";
import { canDropQueueRequest, containsQueuePoint, queueInsertionIndex, queuePlacementRevision } from "../src/lib/queue-placement.ts";
import { validateQueuePlacementInput } from "../src/server/operator-api/event-queue-validation.ts";

const rows = [
  { id: 1, rect: { top: 10, bottom: 110, left: 0, right: 200 } },
  { id: 2, rect: { top: 125, bottom: 425, left: 0, right: 200 } },
  { id: 3, rect: { top: 440, bottom: 500, left: 0, right: 200 } },
];
for (const [name, source, y, expected] of [
  ["first to last", 1, 501, 2], ["last to first", 3, 0, 0],
  ["one down", 1, 276, 1], ["one up", 3, 274, 1],
  ["tall card upper half", 1, 126, 0], ["tall card lower half", 1, 424, 1],
  ["exact midpoint follows card", 1, 275, 1], ["gap", 3, 120, 1],
  ["before top edge", 3, 10, 0], ["after bottom edge", 1, 500, 2],
] as const) test(name, () => assert.equal(queueInsertionIndex(y, rows, source), expected));
test("scroll translates target and rects equally; empty lane is position one", () => {
  assert.equal(queueInsertionIndex(276 - 200, rows.map(row => ({ ...row, rect: { ...row.rect, top: row.rect.top - 200, bottom: row.rect.bottom - 200 } })), 1), 1);
  assert.equal(queueInsertionIndex(0, [], 1), 0);
  assert.equal(containsQueuePoint(rows[0].rect, { x: -1, y: 50 }), false);
  assert.equal(containsQueuePoint(rows[0].rect, { x: 10, y: 9 }), false);
});
test("status matrix keeps now/history immovable and unordered lanes unordered", () => {
  for (const status of ["now", "done", "skipped"] as const)
    for (const lane of ["pending", "approved", "rejected"] as const) assert.equal(canDropQueueRequest(status, lane), false);
  assert.equal(canDropQueueRequest("pending", "pending"), false);
  assert.equal(canDropQueueRequest("rejected", "rejected"), false);
  assert.equal(canDropQueueRequest("approved", "approved"), true);
});
test("revision is order independent, exact and includes every version/status/position", () => {
  const a = { id: 1, version: 1, status: "approved" as const, position: 1 };
  const b = { id: 2, version: 1, status: "pending" as const, position: 0 };
  assert.equal(queuePlacementRevision([a, b]), queuePlacementRevision([b, a]));
  for (const patch of [{ version: 2 }, { status: "now" as const }, { position: 2 }, { id: 3 }])
    assert.notEqual(queuePlacementRevision([a, b]), queuePlacementRevision([{ ...a, ...patch }, b]));
});
test("placement validation rejects ambiguity, forged authority, unconfirmed rejection and unbounded input", () => {
  const input = { lane: "approved", position: 1, expectedRevision: "v1|1:1:approved:1" };
  assert.equal(validateQueuePlacementInput(input).success, true);
  for (const patch of [{ position: 0 }, { position: 1.1 }, { role: "owner" }, { lane: "now" }, { lane: "rejected" }, { expectedRevision: "x" }, { expectedRevision: "v1|" + "x".repeat(250_000) }])
    assert.equal(validateQueuePlacementInput({ ...input, ...patch }).success, false);
  assert.equal(validateQueuePlacementInput({ ...input, lane: "rejected", confirmed: true }).success, true);
});
