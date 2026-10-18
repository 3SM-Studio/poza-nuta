"use client";

import { useQueueRealtime } from "@/components/realtime/use-queue-realtime";
import type {
  QueueRealtimeInvalidateReason,
} from "@/lib/queue-realtime";

export function useDashboardQueueRealtime(
  eventId: number | null | undefined,
  onInvalidate: (
    reason: QueueRealtimeInvalidateReason,
    signal: AbortSignal,
  ) => void | Promise<void>,
  getRevision?: () => string,
  onRevision?: (revision:string)=>void,
) {
  return useQueueRealtime({
    audience: "dashboard",
    identity: eventId,
    onInvalidate,
    getRevision,
    onRevision,
  });
}
