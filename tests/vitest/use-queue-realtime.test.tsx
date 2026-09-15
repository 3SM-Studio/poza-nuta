// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useQueueRealtime } from "@/components/realtime/use-queue-realtime";
import type { QueueRealtimeInvalidateReason } from "@/lib/queue-realtime";

const realtime = vi.hoisted(() => ({
  broadcast: null as ((message: { payload: unknown }) => void) | null,
  subscribe: null as ((status: string) => void) | null,
  setAuth: vi.fn(),
  removeChannel: vi.fn(),
  channel: {
    on: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    realtime: {
      setAuth: realtime.setAuth,
    },
    channel: vi.fn(() => realtime.channel),
    removeChannel: realtime.removeChannel,
  }),
}));

describe("useQueueRealtime", () => {
  beforeEach(() => {
    realtime.broadcast = null;
    realtime.subscribe = null;
    realtime.setAuth.mockReset();
    realtime.setAuth.mockResolvedValue(undefined);
    realtime.removeChannel.mockReset();
    realtime.channel.on.mockReset();
    realtime.channel.on.mockImplementation(
      (_kind: string, _filter: unknown, callback: typeof realtime.broadcast) => {
        realtime.broadcast = callback;
        return realtime.channel;
      },
    );
    realtime.channel.subscribe.mockReset();
    realtime.channel.subscribe.mockImplementation(
      (callback: typeof realtime.subscribe) => {
        realtime.subscribe = callback;
        return realtime.channel;
      },
    );
  });

  it("unions queued invalidations while keeping one refresh in flight", async () => {
    const firstRefresh = deferred<void>();
    const onInvalidate = vi
      .fn<
        (
          reason: QueueRealtimeInvalidateReason,
          signal: AbortSignal,
        ) => Promise<void>
      >()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValue(undefined);
    renderHook(() =>
      useQueueRealtime({
        audience: "public",
        identity: "AbCdEfGhIjKlMnOpQrStUv",
        onInvalidate,
      }),
    );
    await waitFor(() => expect(realtime.subscribe).not.toBeNull());
    act(() => realtime.subscribe?.("SUBSCRIBED"));
    await waitFor(() => expect(onInvalidate).toHaveBeenCalledTimes(1));

    act(() => {
      realtime.broadcast?.({ payload: queuePayload() });
      realtime.broadcast?.({ payload: capabilityPayload() });
      realtime.broadcast?.({ payload: queuePayload() });
    });
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    expect(onInvalidate.mock.calls[1]?.[0]).toBe("queue");

    await act(async () => {
      firstRefresh.resolve();
      await firstRefresh.promise;
    });

    await waitFor(() => expect(onInvalidate).toHaveBeenCalledTimes(3));
    expect(onInvalidate.mock.calls[2]?.[0]).toBe("capabilities");
  });

  it("uses reconnect for the second successful subscription", async () => {
    const onInvalidate = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useQueueRealtime({
        audience: "public",
        identity: "AbCdEfGhIjKlMnOpQrStUv",
        onInvalidate,
      }),
    );
    await waitFor(() => expect(realtime.subscribe).not.toBeNull());

    act(() => realtime.subscribe?.("SUBSCRIBED"));
    await waitFor(() => expect(onInvalidate).toHaveBeenCalledTimes(1));
    act(() => realtime.subscribe?.("SUBSCRIBED"));
    await waitFor(() => expect(onInvalidate).toHaveBeenCalledTimes(2));

    expect(onInvalidate.mock.calls.map(([reason]) => reason)).toEqual([
      "subscribe",
      "reconnect",
    ]);
  });

  it("aborts the active refresh and drops queued work on unmount", async () => {
    const refresh = deferred<void>();
    const onInvalidate = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useQueueRealtime({
        audience: "public",
        identity: "AbCdEfGhIjKlMnOpQrStUv",
        onInvalidate,
      }),
    );
    await waitFor(() => expect(realtime.subscribe).not.toBeNull());
    act(() => realtime.subscribe?.("SUBSCRIBED"));
    await waitFor(() => expect(onInvalidate).toHaveBeenCalledTimes(1));

    act(() => {
      realtime.broadcast?.({ payload: queuePayload() });
      realtime.broadcast?.({ payload: capabilityPayload() });
    });
    const activeSignal = onInvalidate.mock.calls[1]?.[1] as AbortSignal;
    unmount();
    expect(activeSignal.aborted).toBe(true);
    expect(realtime.removeChannel).toHaveBeenCalledWith(realtime.channel);

    await act(async () => {
      refresh.resolve();
      await refresh.promise;
    });
    expect(onInvalidate).toHaveBeenCalledTimes(2);
  });
});

function queuePayload() {
  return {
    type: "queue_changed",
    changedAt: "2026-09-15T12:00:00.000Z",
  };
}

function capabilityPayload() {
  return {
    type: "queue_changed",
    reason: "capabilities_changed",
    changedAt: "2026-09-15T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
