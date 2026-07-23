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
  identity,
  onInvalidate,
}: {
  audience: QueueRealtimeAudience;
  identity: number | string | null | undefined;
  onInvalidate: (
    reason: QueueRealtimeInvalidateReason,
    signal: AbortSignal,
  ) => void | Promise<void>;
}) {
  const [connection, setConnection] = useState<{
    identity: number | string | null;
    status: QueueRealtimeConnectionStatus;
  }>({
    identity: null,
    status: "connecting",
  });
  const onInvalidateRef = useRef(onInvalidate);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    if (!identity) {
      return;
    }

    const realtimeIdentity = identity;
    const supabase = createClient();
    const topic =
      audience === "dashboard"
        ? getDashboardQueueRealtimeTopic(realtimeIdentity as number)
        : getPublicQueueRealtimeTopic(realtimeIdentity as string);
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
                  realtimeIdentity as number,
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
              identity: realtimeIdentity,
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
              identity: realtimeIdentity,
              status: "unavailable",
            });
          }
        });
    }

    void subscribe().catch(() => {
      if (active) {
        setConnection({
          identity: realtimeIdentity,
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
  }, [audience, identity]);

  if (!identity) {
    return "unavailable";
  }

  return connection.identity === identity ? connection.status : "connecting";
}
