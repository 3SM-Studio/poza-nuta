// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQueueRealtime } from "@/components/realtime/use-queue-realtime";
import type { QueueRealtimeInvalidateReason } from "@/lib/queue-realtime";

const realtime = vi.hoisted(() => ({
  heartbeat: null as ((status: string) => void) | null,
  auth: null as ((event: string, session: {user:{id:string}} | null) => void) | null,
  channelCalls: vi.fn(),
  sendHeartbeat: vi.fn(),
  disconnect: vi.fn(),
  heartbeatTimer: undefined as ReturnType<typeof setTimeout>|number|undefined,
  broadcast: null as ((message: { payload: unknown }) => void) | null,
  subscribe: null as ((status: string) => void) | null,
  setAuth: vi.fn(),
  removeChannel: vi.fn(),
  channel: {
    on: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/client", () => {
  const client = {
    realtime: {
      setAuth: realtime.setAuth,
      onHeartbeat: (callback: (status: string) => void) => { realtime.heartbeat = callback; },
      isConnected: () => true,
      heartbeatIntervalMs: 30000,
      get heartbeatTimer(){ return realtime.heartbeatTimer; },
      sendHeartbeat: realtime.sendHeartbeat,
      disconnect: realtime.disconnect,
    },
    auth: { onAuthStateChange: (callback: typeof realtime.auth) => { realtime.auth = callback; return {data:{subscription:{unsubscribe:vi.fn()}}}; } },
    channel: (...args: unknown[]) => {realtime.channelCalls(...args);return realtime.channel;},
    removeChannel: realtime.removeChannel,
  };
  return { createClient: () => client };
});

describe("useQueueRealtime", () => {
  it('deduplicates committed revisions, detects sequence gaps and always recovers after reconnect',async()=>{
    let revision='5';const onInvalidate=vi.fn<(reason:QueueRealtimeInvalidateReason,signal:AbortSignal)=>Promise<void>>(async()=>{revision='8';});
    renderHook(()=>useQueueRealtime({audience:'dashboard',identity:7,onInvalidate,getRevision:()=>revision}));
    await waitFor(()=>expect(realtime.subscribe).not.toBeNull());
    const payload=(value:string)=>({eventId:7,type:'queue_changed',operation:'UPDATE',changedAt:'now',revision:value});
    await act(async()=>{realtime.broadcast?.({payload:payload('4')});realtime.broadcast?.({payload:payload('5')});});
    expect(onInvalidate).not.toHaveBeenCalled();
    await act(async()=>realtime.broadcast?.({payload:payload('8')}));expect(onInvalidate.mock.calls[0]?.[0]).toBe('reconnect');
    await act(async()=>realtime.broadcast?.({payload:payload('8')}));expect(onInvalidate).toHaveBeenCalledTimes(1);
    await act(async()=>realtime.subscribe?.('SUBSCRIBED'));await act(async()=>realtime.subscribe?.('SUBSCRIBED'));
    expect(onInvalidate).toHaveBeenCalledTimes(3);
  });
  it('does not let an untrusted advertised revision suppress subsequent legitimate invalidations',async()=>{
    const onInvalidate=vi.fn(async()=>undefined);
    renderHook(()=>useQueueRealtime({audience:'dashboard',identity:7,onInvalidate,getRevision:()=> '5'}));
    await waitFor(()=>expect(realtime.subscribe).not.toBeNull());
    const payload=(value:string)=>({eventId:7,type:'queue_changed',operation:'UPDATE',changedAt:'now',revision:value});
    await act(async()=>realtime.broadcast?.({payload:payload('999999')}));
    await act(async()=>realtime.broadcast?.({payload:payload('6')}));expect(onInvalidate).toHaveBeenCalledTimes(2);
    await act(async()=>realtime.broadcast?.({payload:payload('not-a-number')}));expect(onInvalidate).toHaveBeenCalledTimes(2);
  });
  beforeEach(() => {
    realtime.broadcast = null;
    realtime.channelCalls.mockClear();
    realtime.sendHeartbeat.mockReset().mockResolvedValue(undefined);
    realtime.disconnect.mockReset().mockResolvedValue('ok');
    realtime.heartbeatTimer = undefined;
    realtime.heartbeat = null;
    realtime.auth = null;
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

  it("subscribes to participant invalidations and rejects payloads for another event", async () => {
    const onInvalidate = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useQueueRealtime({ audience: "participants", identity: 7, onInvalidate }));
    await waitFor(() => expect(realtime.subscribe).not.toBeNull());
    expect(realtime.channel.on).toHaveBeenCalledWith("broadcast", { event: "participants_changed" }, expect.any(Function));
    await act(async () => {
      realtime.broadcast?.({ payload: { type: "participants_changed", eventId: 8, operation: "INSERT", changedAt: "now" } });
    });
    expect(onInvalidate).not.toHaveBeenCalled();
    await act(async () => {
      realtime.broadcast?.({ payload: { type: "participants_changed", eventId: 7, operation: "INSERT", changedAt: "now" } });
    });
    expect(onInvalidate).toHaveBeenCalledWith("queue", expect.any(AbortSignal));
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

    await act(async () => {
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

    await act(async () => {
      realtime.broadcast?.({ payload: queuePayload() });
      realtime.broadcast?.({ payload: capabilityPayload() });
    });
    const activeSignal = onInvalidate.mock.calls[1]?.[1] as AbortSignal;
    unmount();
    expect(activeSignal.aborted).toBe(true);
    await waitFor(() => expect(realtime.removeChannel).toHaveBeenCalledWith(realtime.channel));

    await act(async () => {
      refresh.resolve();
      await refresh.promise;
    });
    expect(onInvalidate).toHaveBeenCalledTimes(2);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const mount = (identity = 7) => renderHook(() => useQueueRealtime({ audience: 'dashboard', identity, onInvalidate: vi.fn().mockResolvedValue(undefined) }));
  async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

  it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])('recreates %s without F5 and ignores a retired generation', async status => {
    vi.useFakeTimers(); const hook = mount(); await flush();
    const old = realtime.subscribe; act(() => old?.('SUBSCRIBED'));
    act(() => old?.(status)); expect(hook.result.current).toBe('recovering');
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(realtime.channelCalls).toHaveBeenCalledTimes(2);
    act(() => old?.('SUBSCRIBED')); expect(hook.result.current).toBe('recovering');
    act(() => realtime.subscribe?.('SUBSCRIBED')); expect(hook.result.current).toBe('live');
  });
  it('recovers from initial setAuth rejection and a hung auth promise', async () => {
    vi.useFakeTimers(); realtime.setAuth.mockRejectedValueOnce(new Error('secret must not be logged'));
    const hook = mount(); await flush(); expect(hook.result.current).toBe('recovering');
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    act(() => realtime.subscribe?.('SUBSCRIBED')); expect(hook.result.current).toBe('live'); hook.unmount(); await flush();
    realtime.setAuth.mockImplementationOnce(() => new Promise(() => {}));
    const second = mount(); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(14000); });
    expect(realtime.channelCalls).toHaveBeenCalledTimes(2); // successful first mount + recovered second
    act(() => realtime.subscribe?.('SUBSCRIBED')); expect(second.result.current).toBe('live');
  });
  it('shares a topic across responsive mounts and retains it until last release', async () => {
    const first = mount(), second = mount(); await flush();
    expect(realtime.channelCalls).toHaveBeenCalledTimes(1);
    act(() => realtime.subscribe?.('SUBSCRIBED')); expect(first.result.current).toBe('live'); expect(second.result.current).toBe('live');
    first.unmount(); expect(realtime.removeChannel).not.toHaveBeenCalled();
    second.unmount(); await flush(); expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
  });
  it('lets SDK rejoin win without rebuilding and throttles focus storms', async () => {
    vi.useFakeTimers(); const invalidate = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useQueueRealtime({audience:'dashboard',identity:7,onInvalidate:invalidate})); await flush();
    act(() => realtime.subscribe?.('SUBSCRIBED')); await flush();
    act(() => realtime.subscribe?.('CHANNEL_ERROR')); act(() => realtime.subscribe?.('SUBSCRIBED')); await flush();
    act(() => { for(let i=0;i<50;i++){window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));} });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(realtime.channelCalls).toHaveBeenCalledTimes(1); expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it.each(['timeout','error','disconnected'])('recovers after heartbeat %s', async status => {
    vi.useFakeTimers(); const hook=mount(); await flush();act(()=>realtime.subscribe?.('SUBSCRIBED'));
    act(()=>realtime.heartbeat?.(status)); expect(hook.result.current).toBe('recovering');
    await act(async()=>{await vi.advanceTimersByTimeAsync(1300);});
    act(()=>realtime.subscribe?.('SUBSCRIBED')); expect(hook.result.current).toBe('live');
    const channels=realtime.channelCalls.mock.calls.length;
    act(()=>window.dispatchEvent(new Event('focus')));await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    expect(hook.result.current).toBe('live');expect(realtime.channelCalls).toHaveBeenCalledTimes(channels);
  });
  it('stops on logout, account switch and unmount, but permits token renewal', async () => {
    vi.useFakeTimers();const hook=mount();await flush();
    act(()=>realtime.auth?.('INITIAL_SESSION',{user:{id:'actor-a'}})); await flush();
    act(()=>realtime.subscribe?.('SUBSCRIBED'));
    act(()=>realtime.auth?.('TOKEN_REFRESHED',{user:{id:'actor-a'}}));await flush();expect(hook.result.current).toBe('live');
    act(()=>realtime.subscribe?.('CLOSED'));act(()=>realtime.auth?.('SIGNED_OUT',null));
    await act(async()=>{await vi.advanceTimersByTimeAsync(90000);window.dispatchEvent(new Event('online'));});
    expect(hook.result.current).toBe('unavailable');expect(realtime.channelCalls).toHaveBeenCalledTimes(1);
    hook.unmount();await flush();const next=mount();await flush();
    act(()=>realtime.auth?.('INITIAL_SESSION',{user:{id:'actor-a'}}));act(()=>realtime.subscribe?.('SUBSCRIBED'));
    act(()=>realtime.auth?.('SIGNED_IN',{user:{id:'actor-b'}}));expect(next.result.current).toBe('unavailable');
    next.unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(90000);});expect(realtime.channelCalls).toHaveBeenCalledTimes(2);
  });
  it('retires old event recovery and worker on final unmount; blocked workers fall back',async()=>{
    vi.useFakeTimers();const terminate=vi.fn();
    vi.stubGlobal('Worker',class { onmessage=null;onerror=null;postMessage(){} terminate=terminate; });
    const hook=renderHook(({id})=>useQueueRealtime({audience:'dashboard',identity:id,onInvalidate:vi.fn().mockResolvedValue(undefined)}),{initialProps:{id:7}});
    await flush();const old=realtime.subscribe;act(()=>old?.('CLOSED'));hook.rerender({id:8});await flush();
    act(()=>old?.('SUBSCRIBED'));expect(hook.result.current).not.toBe('live');
    act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(hook.result.current).toBe('live');hook.unmount();await flush();
    expect(terminate).toHaveBeenCalledTimes(2);
    vi.stubGlobal('Worker',class { constructor(){throw new DOMException('CSP blocked');} });
    const next=mount();await flush();act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(next.result.current).toBe('live');
  });
  it('bounds failed reconnect attempts and restores after offline without polling a healthy queue',async()=>{
    vi.useFakeTimers();const hook=mount();await flush();
    for(let i=0;i<30;i++)act(()=>realtime.subscribe?.('CLOSED'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);});expect(realtime.channelCalls).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(realtime.channelCalls).toHaveBeenCalledTimes(2);
    act(()=>realtime.subscribe?.('SUBSCRIBED'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(20*60_000);});expect(realtime.channelCalls).toHaveBeenCalledTimes(2);
    act(()=>window.dispatchEvent(new Event('focus')));expect(hook.result.current).toBe('recovering');
    await act(async()=>{await vi.advanceTimersByTimeAsync(2500);});act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(hook.result.current).toBe('live');
  });
  it('retries failed snapshots separately from the live transport',async()=>{
    vi.useFakeTimers();const invalidate=vi.fn().mockRejectedValueOnce(new Error('api unavailable')).mockResolvedValue(undefined);
    const hook=renderHook(()=>useQueueRealtime({audience:'dashboard',identity:7,onInvalidate:invalidate}));await flush();
    act(()=>realtime.subscribe?.('SUBSCRIBED'));await flush();expect(hook.result.current).toBe('live');
    await act(async()=>{await vi.advanceTimersByTimeAsync(1100);});expect(invalidate).toHaveBeenCalledTimes(2);expect(realtime.channelCalls).toHaveBeenCalledTimes(1);
  });

  it('uses one worker per client and cancels a competing SDK timer before a worker heartbeat',async()=>{
    vi.useFakeTimers();const terminate=vi.fn();let message: ((event:{data:string})=>void)|null=null,error:(()=>void)|null=null;
    const created=vi.fn();
    vi.stubGlobal('Worker',class {constructor(){created();}set onmessage(callback:typeof message){message=callback;}set onerror(callback:typeof error){error=callback;}postMessage(){}terminate=terminate;});
    const first=mount(),second=mount();await flush();act(()=>realtime.subscribe?.('SUBSCRIBED'));
    expect(created).toHaveBeenCalledTimes(1);
    act(()=>realtime.heartbeat?.('sent'));
    const competing=vi.fn();realtime.heartbeatTimer=setTimeout(competing,30_001);
    await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);message?.({data:'heartbeat'});});
    expect(realtime.sendHeartbeat).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(2);});expect(competing).not.toHaveBeenCalled();
    act(()=>error?.());expect(terminate).toHaveBeenCalledTimes(1);expect(first.result.current).toBe('live');
    first.unmount();second.unmount();expect(terminate).toHaveBeenCalledTimes(1);
  });
  it('stays unavailable while offline and rejoins once the network returns',async()=>{
    vi.useFakeTimers();const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
    try{
      const hook=mount();await flush();expect(hook.result.current).toBe('unavailable');
      await act(async()=>{await vi.advanceTimersByTimeAsync(300_000);});expect(realtime.channelCalls).not.toHaveBeenCalled();
      online.mockReturnValue(true);act(()=>window.dispatchEvent(new Event('online')));await act(async()=>{await vi.advanceTimersByTimeAsync(1300);});
      expect(realtime.channelCalls).toHaveBeenCalledTimes(1);act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(hook.result.current).toBe('live');
    }finally{online.mockRestore();}
  });
  it('diagnostics are opt-in, bounded, expire and contain no SDK errors or private topics',async()=>{
    vi.useFakeTimers();const {realtimeDiagnostic}=await import('@/lib/realtime-diagnostics');const hook=mount();await flush();act(()=>realtime.subscribe?.('SUBSCRIBED'));await flush();
    const api=window.kunestuRealtimeDiagnostics!;api.disable();realtimeDiagnostic('auth_error');expect(api.report().events).toHaveLength(0);
    api.enable();for(let i=0;i<125;i++)realtimeDiagnostic('CLOSED',i);
    const report=api.report();expect(report.events).toHaveLength(100);expect(report.events[0].attempt).toBe(25);
    expect(Object.keys(report.events[0]).sort()).toEqual(['at','attempt','kind','online','visible']);
    await act(async()=>{await vi.advanceTimersByTimeAsync(31*60_000);});expect(api.report().events).toHaveLength(0);
    api.disable();hook.unmount();
  });

  it('cannot subscribe with credentials from an auth initialization resolved after logout',async()=>{
    vi.useFakeTimers();const auth=deferred<void>();realtime.setAuth.mockReturnValueOnce(auth.promise);
    const hook=mount();await flush();act(()=>realtime.auth?.('SIGNED_OUT',null));auth.resolve();await flush();
    await act(async()=>{await vi.advanceTimersByTimeAsync(120_000);window.dispatchEvent(new Event('focus'));});
    expect(realtime.channelCalls).not.toHaveBeenCalled();expect(hook.result.current).toBe('unavailable');
  });
  it('a delayed channel leave completes before the same topic is acquired again',async()=>{
    const leave=deferred<void>();realtime.removeChannel.mockReturnValueOnce(leave.promise);
    const first=mount();await flush();act(()=>realtime.subscribe?.('SUBSCRIBED'));first.unmount();await flush();
    const second=mount();await flush();expect(realtime.channelCalls).toHaveBeenCalledTimes(1);
    leave.resolve();await flush();expect(realtime.channelCalls).toHaveBeenCalledTimes(2);
    act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(second.result.current).toBe('live');
  });

  it('a resumed worker detects a suspended task queue even with no focus or visibility event',async()=>{
    vi.useFakeTimers();let message:((event:{data:string})=>void)|null=null;
    vi.stubGlobal('Worker',class {set onmessage(callback:typeof message){message=callback;}onerror=null;postMessage(){}terminate(){};});
    const hook=mount();await flush();act(()=>realtime.subscribe?.('SUBSCRIBED'));await flush();
    await act(async()=>{await vi.advanceTimersByTimeAsync(20*60_000);});expect(hook.result.current).toBe('live');
    act(()=>message?.({data:'heartbeat'}));expect(hook.result.current).toBe('recovering');
    await act(async()=>{await vi.advanceTimersByTimeAsync(1300);});act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(hook.result.current).toBe('live');
  });
  it('retries a failed old channel removal without creating a parallel subscription',async()=>{
    vi.useFakeTimers();const hook=mount();await flush();act(()=>realtime.subscribe?.('SUBSCRIBED'));
    realtime.removeChannel.mockRejectedValueOnce(new Error('Network failed during cleanup'));
    act(()=>realtime.subscribe?.('CLOSED'));await act(async()=>{await vi.advanceTimersByTimeAsync(1300);});
    expect(realtime.channelCalls).toHaveBeenCalledTimes(1);expect(hook.result.current).toBe('recovering');
    await act(async()=>{await vi.advanceTimersByTimeAsync(2500);});expect(realtime.channelCalls).toHaveBeenCalledTimes(2);
    act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(hook.result.current).toBe('live');
  });

  it('suspends SDK socket retries while offline and rejects late initialization until online',async()=>{
    vi.useFakeTimers();const auth=deferred<void>();realtime.setAuth.mockReturnValueOnce(auth.promise);
    const hook=mount();await flush();const online=vi.spyOn(navigator,'onLine','get');
    try{
      online.mockReturnValue(false);act(()=>window.dispatchEvent(new Event('offline')));await flush();auth.resolve();await flush();
      expect(realtime.disconnect).toHaveBeenCalledTimes(1);expect(hook.result.current).toBe('unavailable');
      await act(async()=>{await vi.advanceTimersByTimeAsync(130_000);});expect(realtime.channelCalls).not.toHaveBeenCalled();
      online.mockReturnValue(true);act(()=>window.dispatchEvent(new Event('online')));await flush();
      expect(realtime.channelCalls).toHaveBeenCalledTimes(1);act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(hook.result.current).toBe('live');
    }finally{online.mockRestore();}
  });

  it('rejoins a public participant-only topic anonymously after dashboard Auth logout in another tab',async()=>{
    const hook=renderHook(()=>useQueueRealtime({audience:'public',identity:'AbCdEfGhIjKlMnOpQrStUv',onInvalidate:vi.fn().mockResolvedValue(undefined)}));
    await flush();const old=realtime.subscribe;act(()=>old?.('SUBSCRIBED'));
    act(()=>realtime.auth?.('SIGNED_OUT',null));await flush();
    expect(realtime.channelCalls).toHaveBeenCalledTimes(2);expect(realtime.setAuth).toHaveBeenLastCalledWith();
    act(()=>old?.('SUBSCRIBED'));expect(hook.result.current).not.toBe('live');
    act(()=>realtime.subscribe?.('SUBSCRIBED'));expect(hook.result.current).toBe('live');
  });

  it('does not fetch on hidden visibilitychange and refreshes when the document becomes visible',async()=>{
    vi.useFakeTimers();const invalidate=vi.fn().mockResolvedValue(undefined);
    renderHook(()=>useQueueRealtime({audience:'dashboard',identity:7,onInvalidate:invalidate}));await flush();act(()=>realtime.subscribe?.('SUBSCRIBED'));await flush();
    await act(async()=>{await vi.advanceTimersByTimeAsync(16_000);});
    const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
    try{
      act(()=>document.dispatchEvent(new Event('visibilitychange')));await flush();expect(invalidate).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue('visible');act(()=>document.dispatchEvent(new Event('visibilitychange')));await flush();
      expect(invalidate).toHaveBeenCalledTimes(2);expect(realtime.channelCalls).toHaveBeenCalledTimes(1);
    }finally{visibility.mockRestore();}
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
