export const dashboardQueueRealtimeEvent = "queue_changed";

export type DashboardQueueRealtimeOperation =
  | "INSERT"
  | "UPDATE"
  | "DELETE";

export type DashboardQueueChangedPayload = {
  eventId: number;
  type: typeof dashboardQueueRealtimeEvent;
  operation: DashboardQueueRealtimeOperation;
  changedAt: string;
};

export type DashboardQueueInvalidateReason =
  | "broadcast"
  | "subscribe"
  | "reconnect"
  | "focus";

export function getDashboardQueueRealtimeTopic(eventId: number) {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    throw new Error("Dashboard queue realtime eventId must be a positive integer.");
  }

  return `dashboard:event:${eventId}:queue`;
}

export function isDashboardQueueChangedPayload(
  payload: unknown,
  eventId: number,
): payload is DashboardQueueChangedPayload {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    payload.type === dashboardQueueRealtimeEvent &&
    payload.eventId === eventId &&
    isDashboardQueueRealtimeOperation(payload.operation) &&
    typeof payload.changedAt === "string"
  );
}

function isDashboardQueueRealtimeOperation(
  operation: unknown,
): operation is DashboardQueueRealtimeOperation {
  return operation === "INSERT" || operation === "UPDATE" || operation === "DELETE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
