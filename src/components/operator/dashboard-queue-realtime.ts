export {
  getDashboardQueueRealtimeTopic,
  isDashboardQueueChangedPayload,
  queueRealtimeEvent as dashboardQueueRealtimeEvent,
} from "@/lib/queue-realtime";

export type {
  DashboardQueueChangedPayload,
  DashboardQueueRealtimeOperation,
  QueueRealtimeInvalidateReason as DashboardQueueInvalidateReason,
} from "@/lib/queue-realtime";
