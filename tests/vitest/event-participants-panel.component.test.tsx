// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventParticipantsPanel } from "@/components/operator/event-participants-panel";
import { OperatorClientError } from "@/components/operator/api";
import type { EventParticipantList } from "@/components/operator/event-participants-api";

const { api, callbacks, success } = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn(), callbacks: new Map<string, (reason: string, signal: AbortSignal) => Promise<void>>() }));
vi.mock("sonner", () => ({ toast: { success } }));
vi.mock("@/components/operator/event-participants-api", async (original) => ({ ...await original<object>(), participantApi: api }));
vi.mock("@/components/realtime/use-queue-realtime", () => ({ useQueueRealtime: ({ audience, onInvalidate }: { audience: string; onInvalidate: (reason: string, signal: AbortSignal) => Promise<void> }) => { callbacks.set(audience, onInvalidate); return "live"; } }));

const person = { id: 17, displayName: "Ala", joinedAt: "2026-10-15T20:00:00.000Z", activeCount: 1, completedCount: 3, hasPerformed: true, online: false, onlineUntil: null };
const initialData: EventParticipantList = { items: [person], canManage: true, realtimeEventId: 10, serverNow: "2026-10-15T20:00:00.000Z", nextPresenceCheckAt: null };
const base = "/api/dashboard/organizations/org/events/event/participants";
const detail = { participant: person, requests: [{ id: 30, title: "History Song", artist: "Artist", status: "done", requestedBy: "operator", createdAt: person.joinedAt, startedAt: null, completedAt: person.joinedAt }] };

function renderPanel(data = initialData) { return render(<EventParticipantsPanel organizationId="org" eventId="event" initialData={data} />); }

describe("EventParticipantsPanel", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    callbacks.clear(); api.mockReset(); success.mockReset();
    api.mockImplementation((path: string) => Promise.resolve(path === base ? initialData : path.includes("/songs?") ? { items: [{ id: 8, title: "Catalog Song", artist: "Catalog Artist", source: "manual" }] } : detail));
  });

  it("checks the server at lease deadlines without locally declaring offline or polling the list", async () => {
    vi.useFakeTimers();
    const onlineData = { ...initialData, items: [{ ...person, online: true, onlineUntil: "2026-10-15T20:00:40.000Z" }], nextPresenceCheckAt: "2026-10-15T20:00:40.000Z" };
    api.mockResolvedValueOnce({ items: [{ id: 17, online: true, onlineUntil: "2026-10-15T20:01:10.000Z" }], serverNow: "2026-10-15T20:00:40.100Z", nextPresenceCheckAt: "2026-10-15T20:01:10.000Z" });
    renderPanel(onlineData);
    expect(screen.getByText("Online: 1 / 1")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(40_100); });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenLastCalledWith(`${base}/presence`, expect.any(Object));
    expect(screen.getByText("Online: 1 / 1")).toBeVisible();
    api.mockResolvedValueOnce({ items: [{ id: 17, online: false, onlineUntil: null }], serverNow: "2026-10-15T20:01:10.100Z", nextPresenceCheckAt: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText("Online: 0 / 1")).toBeVisible();
    expect(screen.getByText("Offline")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("shows unknown presence on an expiry check failure and retries the snapshot only", async () => {
    vi.useFakeTimers();
    api.mockRejectedValueOnce(new Error("offline"));
    renderPanel({ ...initialData, items: [{ ...person, online: true }], nextPresenceCheckAt: "2026-10-15T20:00:01.000Z" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(screen.getByText("Sprawdzanie obecności…")).toBeVisible();
    expect(screen.getByRole("alert")).toBeVisible();
    api.mockResolvedValueOnce({ items: [{ id: 17, online: false, onlineUntil: null }], serverNow: "2026-10-15T20:00:16.100Z", nextPresenceCheckAt: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText("Offline")).toBeVisible();
    expect(api.mock.calls.every(([path]) => path === `${base}/presence`)).toBe(true);
  });

  it("selects by ID, shows history and sends only a catalog song ID", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Wybierz uczestnika: Ala" }));
    expect(await screen.findByText("History Song · Artist")).toBeVisible();
    expect(api).toHaveBeenCalledWith(`${base}/17`, expect.any(Object));
    fireEvent.change(screen.getByLabelText("Tytuł lub wykonawca"), { target: { value: "Catalog" } });
    fireEvent.click(screen.getByRole("button", { name: "Szukaj w katalogu" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Catalog Song · Catalog Artist" }));
    fireEvent.click(screen.getByRole("button", { name: "Dodaj zgłoszenie" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${base}/17/requests`, { method: "POST", body: JSON.stringify({ songId: 8 }) }));
    expect(success).toHaveBeenCalledWith("Dodano zgłoszenie w imieniu uczestnika", expect.any(Object));
  });

  it("creates a manual participant with nickname only and selects the returned ID", async () => {
    api.mockImplementation((path: string, init?: RequestInit) => {
      if (path === base && init?.method === "POST") return Promise.resolve({ participant: { id: 21 } });
      return Promise.resolve(path === base ? { ...initialData, items: [...initialData.items, { ...person, id: 21, displayName: "Manual" }] } : { participant: { ...person, id: 21 }, requests: [] });
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj uczestnika" }));
    const dialog = screen.getByRole("dialog", { name: "Dodaj uczestnika" });
    fireEvent.change(within(dialog).getByLabelText("Nick uczestnika"), { target: { value: "Manual" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Utwórz uczestnika" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(base, { method: "POST", body: JSON.stringify({ displayName: "Manual" }) }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${base}/21`, expect.any(Object)));
  });

  it("refreshes join and queue statistics through invalidation without clearing action errors", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Wybierz uczestnika: Ala" }));
    await screen.findByText("History Song · Artist");
    fireEvent.change(screen.getByLabelText("Tytuł lub wykonawca"), { target: { value: "Catalog" } });
    fireEvent.click(screen.getByRole("button", { name: "Szukaj w katalogu" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Catalog Song · Catalog Artist" }));
    api.mockImplementation((path: string) => path.endsWith("/requests") ? Promise.reject(new OperatorClientError(409, "SESSION_REQUEST_LIMIT_REACHED", "Limit")) : Promise.resolve(path === base ? { ...initialData, items: [{ ...person, activeCount: 2 }] } : detail));
    fireEvent.click(screen.getByRole("button", { name: "Dodaj zgłoszenie" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ta osoba ma już 2 aktywne zgłoszenia");
    for (const audience of ["participants", "dashboard"]) {
      await act(async () => { await callbacks.get(audience)?.("queue", new AbortController().signal); });
    }
    expect(screen.getByRole("alert")).toHaveTextContent("Ta osoba ma już 2 aktywne zgłoszenia");
    expect(screen.getByRole("button", { name: "Wybierz uczestnika: Ala" })).toHaveTextContent("Aktywne: 2/2");
  });

  it("shows read-only and empty states and preserves data when refresh fails", async () => {
    api.mockRejectedValue(new Error("Network unavailable"));
    renderPanel({ ...initialData, canManage: false, items: [] });
    expect(screen.queryByRole("button", { name: "Dodaj uczestnika" })).not.toBeInTheDocument();
    expect(screen.getByText("Jeszcze nie ma uczestników")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Odśwież uczestników" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się odświeżyć uczestników");
  });
});

it('identifies an unfinished first performance by confirmations rather than join date or now status',()=>{
 renderPanel({...initialData,items:[{...person,completedCount:0,hasPerformed:true}]});expect(screen.getByRole('button',{name:'Wybierz uczestnika: Ala'})).toHaveTextContent('Pierwszy występ');
});
