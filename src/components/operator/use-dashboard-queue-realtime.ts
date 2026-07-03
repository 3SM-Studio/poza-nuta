"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  dashboardQueueRealtimeEvent,
  getDashboardQueueRealtimeTopic,
  isDashboardQueueChangedPayload,
  type DashboardQueueInvalidateReason,
} from "./dashboard-queue-realtime";

export function useDashboardQueueRealtime(
  eventId: number | null | undefined,
  onInvalidate: (reason: DashboardQueueInvalidateReason) => void | Promise<void>,
) {
  const onInvalidateRef = useRef(onInvalidate);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    if (!eventId) {
      return;
    }

    const realtimeEventId: number = eventId;

    let active = true;
    let channel:
      | ReturnType<ReturnType<typeof createClient>["channel"]>
      | undefined;
    let hasSubscribed = false;
    const supabase = createClient();
    const topic = getDashboardQueueRealtimeTopic(realtimeEventId);

    const invalidate = (reason: DashboardQueueInvalidateReason) => {
      void onInvalidateRef.current(reason);
    };

    const handleFocus = () => {
      invalidate("focus");
    };

    window.addEventListener("focus", handleFocus);

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
        .on("broadcast", { event: dashboardQueueRealtimeEvent }, (message) => {
          if (
            active &&
            isDashboardQueueChangedPayload(message.payload, realtimeEventId)
          ) {
            invalidate("broadcast");
          }
        })
        .subscribe((status) => {
          if (!active) {
            return;
          }

          if (status === "SUBSCRIBED") {
            invalidate(hasSubscribed ? "reconnect" : "subscribe");
            hasSubscribed = true;
            return;
          }

          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            invalidate("reconnect");
          }
        });
    }

    void subscribe().catch(() => {
      if (active) {
        invalidate("reconnect");
      }
    });

    return () => {
      active = false;
      window.removeEventListener("focus", handleFocus);

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [eventId]);
}
