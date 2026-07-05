export const queueRealtimeEvent = "queue_changed";

export type QueueRealtimeConnectionStatus =
  | "connecting"
  | "live"
  | "unavailable";

export type QueueRealtimeInvalidateReason =
  | "broadcast"
  | "subscribe"
  | "reconnect";

export type DashboardQueueRealtimeOperation =
  | "INSERT"
  | "UPDATE"
  | "DELETE";

export type DashboardQueueChangedPayload = {
  eventId: number;
  type: typeof queueRealtimeEvent;
  operation: DashboardQueueRealtimeOperation;
  changedAt: string;
};

export type PublicQueueChangedPayload = {
  type: typeof queueRealtimeEvent;
  changedAt: string;
};

export function getDashboardQueueRealtimeTopic(eventId: number) {
  assertEventId(eventId);
  return `dashboard:event:${eventId}:queue`;
}

export function getPublicQueueRealtimeTopic(eventId: number) {
  assertEventId(eventId);
  return `public:event:${eventId}:queue`;
}

export function isDashboardQueueChangedPayload(
  payload: unknown,
  eventId: number,
): payload is DashboardQueueChangedPayload {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    payload.type === queueRealtimeEvent &&
    payload.eventId === eventId &&
    isDashboardQueueRealtimeOperation(payload.operation) &&
    typeof payload.changedAt === "string"
  );
}

export function isPublicQueueChangedPayload(
  payload: unknown,
): payload is PublicQueueChangedPayload {
  return (
    isRecord(payload) &&
    payload.type === queueRealtimeEvent &&
    typeof payload.changedAt === "string"
  );
}

function assertEventId(eventId: number) {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    throw new Error("Queue realtime eventId must be a positive integer.");
  }
}

function isDashboardQueueRealtimeOperation(
  operation: unknown,
): operation is DashboardQueueRealtimeOperation {
  return operation === "INSERT" || operation === "UPDATE" || operation === "DELETE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
