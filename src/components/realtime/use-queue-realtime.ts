"use client";

import { useEffect, useRef, useState } from "react";

import { acquireRealtime } from "@/lib/realtime-transport";
import { realtimeDiagnostic } from "@/lib/realtime-diagnostics";

import { createClient } from "@/lib/supabase/client";
import {
  getDashboardQueueRealtimeTopic,
  getDashboardParticipantsRealtimeTopic,
  isDashboardParticipantsChangedPayload,
  participantsRealtimeEvent,
  getPublicQueueRealtimeInvalidateReason,
  getPublicQueueRealtimeTopic,
  isDashboardQueueChangedPayload,
  queueRealtimeEvent,
  type QueueRealtimeConnectionStatus,
  type QueueRealtimeInvalidateReason,
} from "@/lib/queue-realtime";

type QueueRealtimeAudience = "dashboard" | "public" | "participants";

export function useQueueRealtime({
  audience,
  identity,
  onInvalidate,
  getRevision,
}: {
  audience: QueueRealtimeAudience;
  identity: number | string | null | undefined;
  getRevision?: () => string;
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
  const revisionRef = useRef(getRevision);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
    revisionRef.current = getRevision;
  }, [onInvalidate, getRevision]);

  useEffect(() => {
    if (!identity) {
      return;
    }

    const realtimeIdentity = identity;
    const supabase = createClient();
    const topic =
      audience === "participants"
        ? getDashboardParticipantsRealtimeTopic(realtimeIdentity as number)
        : audience === "dashboard"
        ? getDashboardQueueRealtimeTopic(realtimeIdentity as number)
        : getPublicQueueRealtimeTopic(realtimeIdentity as string);
    let active = true;
    let hasSubscribed = false;
    let refreshInFlight = false;
    let refreshQueued: QueueRealtimeInvalidateReason | null = null;
    let refreshController: AbortController | null = null;
    let advertisedRevision = -1n;
    let release: (() => void) | undefined;
    let snapshotAt = 0;
    let snapshotRetry = 0;
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;

    const invalidate = (reason: QueueRealtimeInvalidateReason) => {
      if (!active) {
        return;
      }

      if (refreshInFlight) {
        refreshQueued = mergeInvalidateReasons(refreshQueued, reason);
        return;
      }

      refreshInFlight = true;
      refreshController = new AbortController();

      const signal = refreshController.signal;
      Promise.resolve().then(() => onInvalidateRef.current(reason, signal))
        .then(() => {
          if (active) {
            snapshotAt = Date.now(); snapshotRetry = 0; clearTimeout(snapshotTimer); snapshotTimer = undefined;
            // A callback can coalesce with an active read or handle its own UI
            // error. Actual dashboard snapshot success is recorded by its API
            // adapter, never inferred from callback completion here.
          }
        })
        .catch(() => {
          if (!active) return;
          realtimeDiagnostic('snapshot_error');
          if (snapshotRetry < 3 && !snapshotTimer) snapshotTimer = setTimeout(() => {
            snapshotTimer = undefined; invalidate('reconnect');
          }, 1000 * 2 ** snapshotRetry++);
        })
        .finally(() => {
          refreshInFlight = false;
          refreshController = null;
          // Only API snapshots establish a trusted watermark, never broadcasts.
          advertisedRevision = BigInt(revisionRef.current?.() ?? '0');

          if (active && refreshQueued) {
            const queuedReason = refreshQueued;
            refreshQueued = null;
            invalidate(queuedReason);
          }
        });
    };

    try {
      release = acquireRealtime(supabase, topic,
        audience === "participants" ? participantsRealtimeEvent : queueRealtimeEvent, {
        message: (payload) => {
          const message = { payload };
          const reason =
            audience === "participants"
              ? isDashboardParticipantsChangedPayload(message.payload, realtimeIdentity as number) ? "queue" : null
              : audience === "dashboard"
              ? isDashboardQueueChangedPayload(
                  message.payload,
                  realtimeIdentity as number,
                )
                ? "queue"
                : null
              : getPublicQueueRealtimeInvalidateReason(message.payload);

          if (active && reason) {
            if (audience === 'dashboard' && revisionRef.current && isDashboardQueueChangedPayload(message.payload, realtimeIdentity as number) && typeof message.payload.revision === 'string') {
              const revision=BigInt(message.payload.revision), known=BigInt(revisionRef.current());
              if (revision<=known || (refreshInFlight && revision<=advertisedRevision)) return;
              advertisedRevision=revision;
              invalidate(revision>known+1n ? 'reconnect' : reason);
              return;
            }
            invalidate(reason);
          }
        },
        state: (status) => {
          if (!active) return;
          setConnection({ identity: realtimeIdentity, status });
          if (status === 'live') {
            invalidate(hasSubscribed ? 'reconnect' : 'subscribe');
            hasSubscribed = true;
          }
        },
        resume: () => {
          if (Date.now() - snapshotAt > 15_000) invalidate('reconnect');
        },
      });
    } catch {
      setConnection({ identity: realtimeIdentity, status: 'unavailable' });
    }

    return () => {
      active = false;
      refreshQueued = null;
      refreshController?.abort();

      clearTimeout(snapshotTimer);
      release?.();
    };
  }, [audience, identity]);

  if (!identity) {
    return "unavailable";
  }

  return connection.identity === identity ? connection.status : "connecting";
}

function mergeInvalidateReasons(
  current: QueueRealtimeInvalidateReason | null,
  incoming: QueueRealtimeInvalidateReason,
) {
  if (current === null || getInvalidatePriority(incoming) > getInvalidatePriority(current)) {
    return incoming;
  }

  return current;
}

function getInvalidatePriority(reason: QueueRealtimeInvalidateReason) {
  switch (reason) {
    case "reconnect":
      return 4;
    case "capabilities":
      return 3;
    case "subscribe":
      return 2;
    case "queue":
      return 1;
  }
}
