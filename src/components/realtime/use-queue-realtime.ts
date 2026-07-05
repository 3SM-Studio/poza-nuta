"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  getDashboardQueueRealtimeTopic,
  getPublicQueueRealtimeTopic,
  isDashboardQueueChangedPayload,
  isPublicQueueChangedPayload,
  queueRealtimeEvent,
  type QueueRealtimeConnectionStatus,
  type QueueRealtimeInvalidateReason,
} from "@/lib/queue-realtime";

type QueueRealtimeAudience = "dashboard" | "public";

export function useQueueRealtime({
  audience,
  eventId,
  onInvalidate,
}: {
  audience: QueueRealtimeAudience;
  eventId: number | null | undefined;
  onInvalidate: (
    reason: QueueRealtimeInvalidateReason,
    signal: AbortSignal,
  ) => void | Promise<void>;
}) {
  const [connection, setConnection] = useState<{
    eventId: number | null;
    status: QueueRealtimeConnectionStatus;
  }>({
    eventId: null,
    status: "connecting",
  });
  const onInvalidateRef = useRef(onInvalidate);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    if (!eventId) {
      return;
    }

    const realtimeEventId = eventId;
    const supabase = createClient();
    const topic =
      audience === "dashboard"
        ? getDashboardQueueRealtimeTopic(realtimeEventId)
        : getPublicQueueRealtimeTopic(realtimeEventId);
    let active = true;
    let hasSubscribed = false;
    let refreshInFlight = false;
    let refreshQueued = false;
    let refreshController: AbortController | null = null;
    let channel:
      | ReturnType<ReturnType<typeof createClient>["channel"]>
      | undefined;

    const invalidate = (reason: QueueRealtimeInvalidateReason) => {
      if (!active) {
        return;
      }

      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      refreshController = new AbortController();

      Promise.resolve(
        onInvalidateRef.current(reason, refreshController.signal),
      )
        .catch(() => undefined)
        .finally(() => {
          refreshInFlight = false;
          refreshController = null;

          if (active && refreshQueued) {
            refreshQueued = false;
            invalidate("broadcast");
          }
        });
    };

    async function subscribe() {
      await supabase.realtime.setAuth();

      if (!active) {
        return;
      }

      channel = supabase
        .channel(topic, {
          config: {
            private: true,
          },
        })
        .on("broadcast", { event: queueRealtimeEvent }, (message) => {
          const validPayload =
            audience === "dashboard"
              ? isDashboardQueueChangedPayload(
                  message.payload,
                  realtimeEventId,
                )
              : isPublicQueueChangedPayload(message.payload);

          if (active && validPayload) {
            invalidate("broadcast");
          }
        })
        .subscribe((channelStatus) => {
          if (!active) {
            return;
          }

          if (channelStatus === "SUBSCRIBED") {
            setConnection({
              eventId: realtimeEventId,
              status: "live",
            });
            invalidate(hasSubscribed ? "reconnect" : "subscribe");
            hasSubscribed = true;
            return;
          }

          if (
            channelStatus === "CHANNEL_ERROR" ||
            channelStatus === "TIMED_OUT" ||
            channelStatus === "CLOSED"
          ) {
            setConnection({
              eventId: realtimeEventId,
              status: "unavailable",
            });
          }
        });
    }

    void subscribe().catch(() => {
      if (active) {
        setConnection({
          eventId: realtimeEventId,
          status: "unavailable",
        });
      }
    });

    return () => {
      active = false;
      refreshQueued = false;
      refreshController?.abort();

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [audience, eventId]);

  if (!eventId) {
    return "unavailable";
  }

  return connection.eventId === eventId ? connection.status : "connecting";
}
