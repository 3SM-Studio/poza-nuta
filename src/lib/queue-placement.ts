import type { DashboardEventQueueRequestStatus } from "./dashboard-event-queue";

export type QueueLane = "pending" | "approved" | "rejected";
export type QueuePlacement = {
  lane: QueueLane;
  /** One-based index AFTER removing the source. Only approved is manually ordered. */
  position: number;
};
export type QueueDropInput = QueuePlacement & {
  expectedRevision: string;
  confirmed?: boolean;
};
type RevisionItem = { id: number; version: number; status: DashboardEventQueueRequestStatus; position: number };

// An exact, unambiguous version vector, not a probabilistic hash. No PII.
// Every queue writer increments versions; status/position also guard legacy writes.
export function queuePlacementRevision(items: readonly RevisionItem[]) {
  return "v1|" + [...items].sort((a, b) => a.id - b.id)
    .map(row => `${row.id}:${row.version}:${row.status}:${row.position}`).join("|");
}

export function canDropQueueRequest(source: DashboardEventQueueRequestStatus, lane: QueueLane) {
  if (source === "now" || source === "done" || source === "skipped") return false;
  return source !== lane || lane === "approved";
}

export type QueueRect = { left: number; right: number; top: number; bottom: number };
export function containsQueuePoint(rect: QueueRect, point: { x: number; y: number }) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/** Viewport coordinates only. Excludes the source; never uses the overlay rect for pointers. */
export function queueInsertionIndex(y: number, rows: readonly { id: number; rect: QueueRect }[], sourceId: number) {
  const remaining = rows.filter(row => row.id !== sourceId);
  const index = remaining.findIndex(row => y < (row.rect.top + row.rect.bottom) / 2);
  return index < 0 ? remaining.length : index;
}

export function queuePlacementLabel(target: QueuePlacement | null, allowed = true) {
  if (!target) return "Poza miejscem upuszczenia — puść, aby anulować";
  if (!allowed) return "Niedozwolone przeniesienie — puść, aby anulować";
  if (target.lane === "approved") return `Zaakceptowane — pozycja ${target.position}`;
  return target.lane === "rejected" ? "Odrzuć zgłoszenie — wymagane potwierdzenie" : "Przywróć do oczekujących — według czasu zgłoszenia";
}
