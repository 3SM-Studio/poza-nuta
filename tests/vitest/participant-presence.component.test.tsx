// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParticipantPresence } from "@/components/public/participant-presence";

describe("participant tab lifecycle", () => {
  const fetchMock = vi.fn();
  const beacon = vi.fn((_url: string, _data: Blob) => true);
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 }); beacon.mockClear();
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const bodies = () => fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));

  it("keeps one ID for heartbeats, new ID after pagehide, and closes only its own lease", async () => {
    const view = render(<ParticipantPresence sessionToken={"A".repeat(22)} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const first = bodies()[0]; expect(first.action).toBe("connect");
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(bodies()[1]).toEqual({ connectionId: first.connectionId, action: "heartbeat" });
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][1]).toBeInstanceOf(Blob);
    await act(async () => { window.dispatchEvent(new Event("pageshow")); });
    expect(bodies()[2].action).toBe("connect"); expect(bodies()[2].connectionId).not.toBe(first.connectionId);
    view.unmount(); expect(beacon).toHaveBeenCalledTimes(2);
  });

  it("gives different tabs different IDs and stops after rejected credentials", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    const one = render(<ParticipantPresence sessionToken={"A".repeat(22)} />);
    const two = render(<ParticipantPresence sessionToken={"A".repeat(22)} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(bodies()[0].connectionId).not.toBe(bodies()[1].connectionId);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2); one.unmount(); two.unmount();
  });

  it("retries network failure without duplicating the ID and resumes on online", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network failed"));
    const view = render(<ParticipantPresence sessionToken={"A".repeat(22)} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(bodies()[1]).toEqual(bodies()[0]);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(bodies()[2].action).toBe("heartbeat"); view.unmount();
  });

  it("opens a fresh connection promptly when a background lease was cleaned up", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409 }).mockResolvedValue({ ok: true, status: 200 });
    const view = render(<ParticipantPresence sessionToken={"A".repeat(22)} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(bodies()).toHaveLength(2);
    expect(bodies()[1].action).toBe("connect");
    expect(bodies()[1].connectionId).not.toBe(bodies()[0].connectionId);
    view.unmount();
  });
});
