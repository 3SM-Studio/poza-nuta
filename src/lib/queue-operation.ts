import type { DashboardEventQueueAction, DashboardEventQueueRequestStatus } from './dashboard-event-queue.ts';
import type { QueueLane } from './queue-placement.ts';

export type QueueAnchor = { id: number; intentVersion: number };
export type QueueOperation = {
  operationId: string;
  deviceId: string;
  actorId: number;
  requestId: number;
  expectedIntentVersion: number;
  expectedStatus: DashboardEventQueueRequestStatus;
  sortRevision: string;
} & ({ kind: 'action'; action: DashboardEventQueueAction; expectedNow: QueueAnchor | null }
  | { kind: 'placement'; lane: QueueLane; before: QueueAnchor | null; after: QueueAnchor | null; confirmed: boolean });

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isQueueOperationId(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }
const integer = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const anchor = (v: unknown): v is QueueAnchor | null => v === null || (record(v) && Object.keys(v).length === 2 && integer(v.id, 1) && integer(v.intentVersion));

export function parseQueueOperation(value: unknown): QueueOperation | null {
  if (!record(value) || !isQueueOperationId(value.operationId) || !isQueueOperationId(value.deviceId) ||
    !integer(value.actorId,1) || !integer(value.requestId, 1) || !integer(value.expectedIntentVersion) ||
    typeof value.expectedStatus !== 'string' || !['pending','approved','now','done','skipped','rejected'].includes(value.expectedStatus) ||
    typeof value.sortRevision !== 'string' || !/^\d{1,19}$/.test(value.sortRevision)) return null;
  const common = { operationId: value.operationId.toLowerCase(), deviceId: value.deviceId.toLowerCase(), actorId:value.actorId, requestId: value.requestId,
    expectedIntentVersion: value.expectedIntentVersion, expectedStatus: value.expectedStatus as DashboardEventQueueRequestStatus, sortRevision: value.sortRevision };
  if (value.kind === 'action' && Object.keys(value).length === 10 &&
    typeof value.action === 'string' && ['approve','start','reject','done','restore'].includes(value.action) && anchor(value.expectedNow)) {
    return { ...common, kind: 'action', action: value.action as DashboardEventQueueAction, expectedNow: value.expectedNow };
  }
  if (value.kind === 'placement' && Object.keys(value).length === 12 && typeof value.lane === 'string' && ['pending','approved','rejected'].includes(value.lane) &&
    anchor(value.before) && anchor(value.after) && typeof value.confirmed === 'boolean' &&
    value.before?.id !== value.requestId && value.after?.id !== value.requestId &&
    !(value.before && value.after && value.before.id === value.after.id)) {
    return { ...common, kind: 'placement', lane: value.lane as QueueLane, before: value.before, after: value.after, confirmed: value.confirmed };
  }
  return null;
}

export type QueueIntentItem = { id: number; status: DashboardEventQueueRequestStatus; position: number; intentVersion?: number };
export function queueAnchor(item: QueueIntentItem | undefined): QueueAnchor | null {
  return item ? { id: item.id, intentVersion: item.intentVersion ?? 0 } : null;
}

/** Relative intent survives unrelated renumbering. Moved/deleted anchors require a decision. */
export function resolveQueueOperationPosition(items: readonly QueueIntentItem[], operation: Extract<QueueOperation, { kind: 'placement' }>): number | null {
  const rows = items.filter(x => x.status === 'approved' && x.id !== operation.requestId).sort((a,b) => a.position-b.position || a.id-b.id);
  for (const a of [operation.before, operation.after]) {
    if (a && !rows.some(x => x.id === a.id && (x.intentVersion ?? 0) === a.intentVersion)) return null;
  }
  const before = operation.before ? rows.findIndex(x => x.id === operation.before!.id) : rows.length;
  const after = operation.after ? rows.findIndex(x => x.id === operation.after!.id) : -1;
  if (after >= before) return null;
  return operation.before ? before + 1 : after + 2;
}
