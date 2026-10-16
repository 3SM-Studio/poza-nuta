import type { DashboardEventQueueRequestStatus } from "../lib/dashboard-event-queue";

/** Verified event snapshot. Times are server epoch milliseconds, never client time. */
export type FairQueueRequest = Readonly<{
  id: number;
  participantId: number | null;
  status: DashboardEventQueueRequestStatus;
  position: number;
  createdAt: number;
  approvedAt: number;
  waitingSince: number | null;
  startedAt: number | null;
  completedAt: number | null;
}>;

export type FairQueuePriority = {
  completed: number;
  allocated: number;
  ordinal: number;
  waitCredit: number;
  round: number;
};

const owner = (request: FairQueueRequest) => request.participantId === null
  ? `legacy:${request.id}` : `participant:${request.participantId}`;
const approvalOrder = (a: FairQueueRequest, b: FairQueueRequest) => a.approvedAt - b.approvedAt || a.id - b.id;
const positionOrder = (a: FairQueueRequest, b: FairQueueRequest) => a.position - b.position || a.createdAt - b.createdAt || a.id - b.id;

function prepare(snapshot: readonly FairQueueRequest[]) {
  const approved = snapshot.filter(row => row.status === "approved").sort(approvalOrder);
  const done = snapshot.filter(row => row.status === "done");
  const now = snapshot.filter(row => row.status === "now");
  const counts = new Map<string, { completed: number; allocated: number; ordinal: number }>();
  for (const row of [...done, ...now, ...approved]) {
    const key = owner(row);
    const count = counts.get(key) ?? { completed: 0, allocated: 0, ordinal: 0 };
    if (row.status === "done") count.completed++;
    if (row.status === "now") count.allocated++;
    counts.set(key, count);
  }
  const priorities = new Map<number, FairQueuePriority>();
  for (const row of approved) {
    const key = owner(row);
    const count = counts.get(key)!;
    const waitCredit = row.waitingSince === null ? 0 : done.filter(performance => owner(performance) !== key &&
      performance.completedAt !== null && performance.completedAt > row.waitingSince!).length;
    const ordinal = count.ordinal++;
    priorities.set(row.id, {
      completed: count.completed, allocated: count.allocated, ordinal, waitCredit,
      round: Math.max(0, count.completed + count.allocated - waitCredit) + ordinal,
    });
  }
  const compare = (a: FairQueueRequest, b: FairQueueRequest) => {
    const left = priorities.get(a.id)!, right = priorities.get(b.id)!;
    return left.round - right.round || left.ordinal - right.ordinal || approvalOrder(a, b);
  };
  const recent = (rows: FairQueueRequest[], time: (row: FairQueueRequest) => number) =>
    [...rows].sort((a, b) => time(b) - time(a) || b.id - a.id)[0];
  const previous = recent(now, row => row.startedAt ?? row.createdAt) ??
    recent(done, row => row.completedAt ?? row.startedAt ?? row.createdAt);
  return { approved, priorities, compare, previousOwner: previous ? owner(previous) : null };
}

/** Full explicit sort. Input ordering and wall clock cannot affect the result. */
export function proposeFairQueue(snapshot: readonly FairQueueRequest[]) {
  const { approved, priorities, compare, previousOwner } = prepare(snapshot);
  const remaining = [...approved].sort(compare);
  const order: number[] = [];
  let previous = previousOwner;
  while (remaining.length) {
    const alternative = remaining.findIndex(row => owner(row) !== previous);
    const [next] = remaining.splice(alternative < 0 ? 0 : alternative, 1);
    order.push(next.id);
    previous = owner(next);
  }
  return { order, priorities };
}

/** Constrained insertion: no pair of existing approved requests is reordered. */
export function insertFairQueue(snapshot: readonly FairQueueRequest[], requestId: number) {
  const { approved, compare, previousOwner } = prepare(snapshot);
  const inserted = approved.find(row => row.id === requestId);
  if (!inserted) throw new Error("Fair insertion requires an approved request");
  const existing = approved.filter(row => row.id !== requestId).sort(positionOrder);
  const key = owner(inserted);
  const minimum = existing.reduce((index, row, i) => owner(row) === key ? i + 1 : index, 0);
  let bestIndex = minimum, bestEdges = Infinity, bestInversions = Infinity;
  const same = (a: string | null, b: string | null) => a !== null && a === b ? 1 : 0;
  for (let index = minimum; index <= existing.length; index++) {
    const before = index ? owner(existing[index - 1]) : previousOwner;
    const after = index < existing.length ? owner(existing[index]) : null;
    const edges = same(before, key) + same(key, after) - same(before, after);
    const inversions = existing.reduce((sum, row, i) => sum +
      (i < index ? Number(compare(inserted, row) < 0) : Number(compare(inserted, row) > 0)), 0);
    if (edges < bestEdges || (edges === bestEdges && inversions < bestInversions)) {
      bestIndex = index; bestEdges = edges; bestInversions = inversions;
    }
  }
  const order = existing.map(row => row.id);
  order.splice(bestIndex, 0, requestId);
  return order;
}
