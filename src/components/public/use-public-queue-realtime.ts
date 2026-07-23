"use client";

import { useQueueRealtime } from "@/components/realtime/use-queue-realtime";
import type { QueueRealtimeInvalidateReason } from "@/lib/queue-realtime";

export function usePublicQueueRealtime(
  publicToken: string | null | undefined,
  onInvalidate: (
    reason: QueueRealtimeInvalidateReason,
    signal: AbortSignal,
  ) => void | Promise<void>,
) {
  return useQueueRealtime({
    audience: "public",
    identity: publicToken,
    onInvalidate,
  });
}
