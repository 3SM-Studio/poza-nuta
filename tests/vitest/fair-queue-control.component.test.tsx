// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FairQueueControl } from "@/components/operator/fair-queue-control";
import { OperatorClientError } from "@/components/operator/api";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn(), toast: vi.fn() }));
vi.mock("@/components/operator/event-queue-api", () => ({ previewDashboardFairQueue: mocks.preview, applyDashboardFairQueue: mocks.apply }));
vi.mock("sonner", () => ({ toast: { success: mocks.toast } }));
const proposal = { revision: "a".repeat(64), changes: [
  { id: 1, from: 2, to: 1, displayName: "Singer A", songTitle: "Song A" },
  { id: 2, from: 1, to: 2, displayName: "Singer B", songTitle: "Song B" },
] };
function setup(disabled = false) {
  const applied = vi.fn(), busy = vi.fn();
  render(<FairQueueControl organizationId="org" eventId="event" disabled={disabled} onApplied={applied} onBusyChange={busy} />);
  return { applied, busy };
}
beforeEach(() => { vi.resetAllMocks(); mocks.preview.mockResolvedValue(proposal); mocks.apply.mockResolvedValue({ changed: 2, items: [] }); });
it("shows accessible from/to preview and cancel leaves the queue untouched", async () => {
  setup(); fireEvent.click(screen.getByRole("button", { name: "Ułóż sprawiedliwie" }));
  const dialog = await screen.findByRole("dialog", { name: "Ułóż sprawiedliwie" });
  expect(await within(dialog).findByText("Song A")).toBeVisible();
  expect(within(dialog).getByLabelText("Pozycja 2, proponowana 1")).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Anuluj" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.apply).not.toHaveBeenCalled();
});
it("applies only after explicit confirmation, delivers canonical items and reports success", async () => {
  const { applied, busy } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Ułóż sprawiedliwie" }));
  const button = await screen.findByRole("button", { name: "Zastosuj kolejność" });
  expect(mocks.apply).not.toHaveBeenCalled(); fireEvent.click(button);
  await waitFor(() => expect(applied).toHaveBeenCalledWith([]));
  expect(mocks.apply).toHaveBeenCalledWith("org", "event", proposal.revision, expect.any(AbortSignal));
  expect(mocks.toast).toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(false);
});
it("rejects a stale preview and requires a new one instead of silently applying different data", async () => {
  setup(); mocks.apply.mockRejectedValue(new OperatorClientError(409, "FAIR_QUEUE_PREVIEW_STALE", "Stale"));
  fireEvent.click(screen.getByRole("button", { name: "Ułóż sprawiedliwie" }));
  fireEvent.click(await screen.findByRole("button", { name: "Zastosuj kolejność" }));
  expect(await screen.findByText(/Kolejka zmieniła się od podglądu/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Zastosuj kolejność" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Odśwież podgląd" }));
  await screen.findByRole("button", { name: "Zastosuj kolejność" }); expect(mocks.apply).toHaveBeenCalledTimes(1);
});
it("handles preview network failures and an empty queue", async () => {
  setup(); mocks.preview.mockRejectedValueOnce(new TypeError("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Ułóż sprawiedliwie" }));
  expect(await screen.findByText(/Nie udało się pobrać podglądu/)).toBeVisible();
  mocks.preview.mockResolvedValue({ revision: "b".repeat(64), changes: [] });
  fireEvent.click(screen.getByRole("button", { name: "Odśwież podgląd" }));
  expect(await screen.findByText("Brak zaakceptowanych utworów do ułożenia.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Zastosuj kolejność" })).toBeDisabled();
});
it("blocks duplicate apply while a request is in flight and disables unavailable actions", async () => {
  let resolve!: (result: { changed: number; items: [] }) => void;
  mocks.apply.mockReturnValue(new Promise(r => { resolve = r; }));
  setup(); fireEvent.click(screen.getByRole("button", { name: "Ułóż sprawiedliwie" }));
  fireEvent.click(await screen.findByRole("button", { name: "Zastosuj kolejność" }));
  expect(screen.getByRole("button", { name: "Zapisywanie…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
  expect(mocks.apply).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ changed: 2, items: [] }));
});
it("does not request a preview when access is disabled", () => {
  setup(true); expect(screen.getByRole("button", { name: "Ułóż sprawiedliwie" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Ułóż sprawiedliwie" })); expect(mocks.preview).not.toHaveBeenCalled();
});
