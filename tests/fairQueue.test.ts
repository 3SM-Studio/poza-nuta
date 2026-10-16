import assert from "node:assert/strict";
import test from "node:test";
import { insertFairQueue, proposeFairQueue, type FairQueueRequest } from "../src/server/fair-queue.ts";

const row = (id: number, participantId: number | null, extra: Partial<FairQueueRequest> = {}): FairQueueRequest => ({
  id, participantId, status: "approved", position: id, createdAt: id,
  approvedAt: 1000 + id, waitingSince: extra.approvedAt ?? 1000 + id, startedAt: null, completedAt: null, ...extra,
});
const done = (id: number, participantId: number, completedAt = id) => row(id, participantId, { status: "done", position: 0, completedAt });
const order = (rows: FairQueueRequest[]) => proposeFairQueue(rows).order;

test("fair queue: three new participants have a stable approval/ID order independent of SQL order", () => {
  const rows = [row(1, 1), row(2, 2), row(3, 3)];
  assert.deepEqual(order(rows), [1, 2, 3]);
  assert.deepEqual(order([...rows].reverse()), [1, 2, 3]);
  assert.deepEqual(order(rows.map(r => ({ ...r, approvedAt: 1000 }))), [1, 2, 3]);
});
test("fair queue: newcomer, once-performed and three-times-performed", () => {
  assert.deepEqual(order([row(1, 1), row(2, 2), row(3, 3), done(101, 1), done(102, 1), done(103, 1), done(104, 2)]), [3, 2, 1]);
});
test("fair queue: two songs of one owner are separated by another first song", () => {
  assert.deepEqual(order([row(1, 1), row(2, 1), row(3, 2)]), [1, 3, 2]);
});
test("fair queue: equal rounds prefer the first queued song over somebody else's second", () => {
  assert.deepEqual(order([row(1, 1), row(2, 1), row(3, 2), done(100, 2)]), [1, 3, 2]);
});
test("fair queue: equal history of three owners retains deterministic ties", () => {
  assert.deepEqual(order([row(1, 1), row(2, 2), row(3, 3), done(101, 1), done(102, 2), done(103, 3)]), [1, 2, 3]);
});
test("fair queue: now reserves a round and seeds adjacency without being reordered", () => {
  const now = row(10, 1, { status: "now", position: 0, startedAt: 2000 });
  const rows = [now, row(1, 1), row(2, 2), done(100, 2)];
  assert.deepEqual(order(rows), [2, 1]);
  assert.equal(proposeFairQueue(rows).priorities.get(1)?.allocated, 1);
  assert.deepEqual(now, rows[0]);
});
test("fair queue: adjacency is soft when only one person has two songs", () => {
  assert.deepEqual(order([row(1, 1), row(2, 1), row(10, 1, { status: "now" })]), [1, 2]);
});
test("fair insert preserves every manual pair, while explicit sort can replace it", () => {
  const rows = [row(1, 1, { position: 2 }), row(2, 2, { position: 1 }), row(3, 3, { position: 3 })];
  assert.deepEqual(insertFairQueue(rows, 3).filter(id => id !== 3), [2, 1]);
  assert.deepEqual(order(rows), [1, 2, 3]);
});
test("fair queue: repeated full sort is idempotent", () => {
  const rows = [row(1, 1), row(2, 1), row(3, 2), row(4, 3)];
  const first = order(rows);
  assert.deepEqual(first, [1, 3, 4, 2]);
  assert.deepEqual(order(rows.map(r => ({ ...r, position: first.indexOf(r.id) + 1 }))), first);
});
test("fair queue: null owners are separate request-scoped legacy singers", () => {
  const rows = [row(1, null), row(2, null), row(3, 3), row(100, null, { status: "done", completedAt: 10 })];
  assert.deepEqual(order(rows), [1, 2, 3]);
  assert.equal(proposeFairQueue(rows).priorities.get(1)?.completed, 0);
});

test("fair queue: missing approval audit cannot invent credit for time pending", () => {
  const legacy = row(1, 1, { approvedAt: 1, waitingSince: null });
  const rows = [legacy, row(2, 2), done(10, 1, 2), done(11, 1, 3), done(12, 3, 500)];
  assert.deepEqual(order(rows), [2, 1]);
  assert.equal(proposeFairQueue(rows).priorities.get(1)?.waitCredit, 0);
  assert.deepEqual(order([...rows].reverse()), [2, 1]);
  const anchored = rows.map(r => r.id === 1 ? { ...r, waitingSince: 600 } : r);
  assert.equal(proposeFairQueue(anchored).priorities.get(1)?.waitCredit, 0);
  assert.equal(proposeFairQueue([...anchored, done(13, 4, 700)]).priorities.get(1)?.waitCredit, 1);
});
test("fair queue: combined canonical merge history counts each request once", () => {
  const rows = [row(1, 9), row(2, 2), done(101, 9), done(102, 9)];
  assert.deepEqual(order(rows), [2, 1]);
  assert.equal(proposeFairQueue(rows).priorities.get(1)?.completed, 2);
});
test("fair queue: pending/rejected/skipped neither reserve ordinals nor count as history", () => {
  const rows = [row(1, 1), row(2, 2), row(10, 1, { status: "pending" }), row(11, 1, { status: "rejected" }), row(12, 1, { status: "skipped" })];
  assert.deepEqual(order(rows), [1, 2]);
  assert.equal(proposeFairQueue(rows).priorities.get(1)?.ordinal, 0);
  assert.equal(proposeFairQueue(rows).priorities.get(1)?.completed, 0);
});
test("fair queue: done-to-restore follows current-status history semantics", () => {
  const rows = [row(1, 1), row(2, 2), done(100, 1)];
  assert.deepEqual(order(rows), [2, 1]);
  assert.deepEqual(order(rows.map(r => r.id === 100 ? { ...r, status: "pending", completedAt: null } : r)), [1, 2]);
});
test("fair insert: newcomers get priority without rebuilding experienced singers' manual order", () => {
  const rows = [row(1, 1, { position: 2 }), row(2, 2, { position: 1 }), done(101, 1), done(102, 1), done(103, 2), row(3, 3)];
  assert.deepEqual(insertFairQueue(rows, 3), [3, 2, 1]);
});
test("fair queue: continuous newcomers cannot starve an older experienced singer", () => {
  let rows = [row(1, 1, { approvedAt: 100 }), done(10, 1, 1), done(11, 1, 2), done(12, 1, 3)];
  const played: number[] = [];
  for (let turn = 0; turn < 12; turn++) {
    rows.push(row(100 + turn, 100 + turn, { approvedAt: 200 + turn * 100 }));
    const next = order(rows)[0];
    played.push(next);
    rows = rows.map(r => r.id === next ? { ...r, status: "done", completedAt: 250 + turn * 100 } : r);
  }
  assert.deepEqual(played.slice(0, 4), [100, 101, 102, 1]);
  assert.deepEqual(played, [100, 101, 102, 1, 103, 104, 105, 106, 107, 108, 109, 110]);
});
test("fair insert respects now/last-done adjacency and repairs a repeated-owner edge", () => {
  const rows = [row(1, 1), row(2, 1), row(3, 2), row(9, 1, { status: "now" })];
  assert.deepEqual(insertFairQueue(rows, 3), [3, 1, 2]);
  assert.deepEqual(insertFairQueue(rows.filter(r => r.id !== 9), 3), [1, 3, 2]);
  assert.deepEqual(insertFairQueue([row(1, 1), row(2, 2), row(9, 2, { status: "now" })], 2), [1, 2]);
});
test("fair insert never puts a new song ahead of that owner's existing manually ordered songs", () => {
  assert.deepEqual(insertFairQueue([row(1, 1, { position: 2 }), row(2, 1, { position: 1 }), row(3, 1)], 3), [2, 1, 3]);
});
