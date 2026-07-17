// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminImportsPanel } from "@/components/platform-admin/admin-imports-panel";
import {
  activeImportRefreshMilliseconds,
  type ImportAdminPageData,
} from "@/server/platform-admin/import-admin-core";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  vi.useRealTimers();
  refresh.mockReset();
});

describe("AdminImportsPanel", () => {
  it("keeps support read-only", () => {
    renderPanel({
      capabilities: { canStartISing: false, canCancel: false },
    });

    expect(screen.getByRole("button", { name: "Sprawdź iSing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Importuj iSing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
    expect(screen.getByText(/dostęp tylko do odczytu/i)).toBeVisible();
  });

  it("disables starts while an iSing job is active", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Sprawdź iSing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Importuj iSing" })).toBeDisabled();
  });

  it("requires confirmation and exposes a pending write state", async () => {
    let resolveWrite: ((value: { kind: "success"; message: string }) => void) | undefined;
    const startWrite = vi.fn(
      () =>
        new Promise<{ kind: "success"; message: string }>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    renderPanel({ jobs: [], startWrite });

    fireEvent.click(screen.getByRole("button", { name: "Importuj iSing" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-management-theme", "true");
    expect(startWrite).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Tak, importuj" }));
    expect(startWrite).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole("button", { name: "Dodawanie…" })).toBeDisabled();

    await act(async () => {
      resolveWrite?.({ kind: "success", message: "Dodano." });
    });
    await waitFor(() => expect(screen.getByText("Dodano.")).toBeVisible());
    expect(refresh).toHaveBeenCalled();
  });

  it("requires confirmation before cancelling an active job", async () => {
    const cancelJob = vi.fn(async () => ({
      kind: "success" as const,
      message: "Anulowanie zapisane.",
    }));
    renderPanel({ cancelJob });

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("data-management-theme", "true");
    expect(cancelJob).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Wróć" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(cancelJob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    const confirmedDialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmedDialog).getByRole("button", { name: "Tak, anuluj" }),
    );

    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith(activeJob.id));
    expect(await screen.findByText("Anulowanie zapisane.")).toBeVisible();
  });

  it("polls only while a job is active", async () => {
    vi.useFakeTimers();
    const { rerender } = renderPanel();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(activeImportRefreshMilliseconds);
    });
    expect(refresh).toHaveBeenCalledOnce();

    refresh.mockReset();
    rerender(
      <AdminImportsPanel
        data={pageData({ jobs: [] })}
        startDryRun={vi.fn()}
        startWrite={vi.fn()}
        cancelJob={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(activeImportRefreshMilliseconds * 2);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows unknown progress without a fabricated percentage", () => {
    renderPanel({
      jobs: [
        {
          ...activeJob,
          totalCount: 0,
          processedCount: 3,
        },
      ],
    });

    expect(screen.getByText(/suma nie jest jeszcze znana/i)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("Poprawne")).toBeVisible();
    expect(screen.queryByText("Zaimportowane")).not.toBeInTheDocument();
    expect(screen.getByText("Żądanie anulowania")).toBeVisible();
  });

  it("keeps the imported counter label for write jobs", () => {
    renderPanel({
      jobs: [{ ...activeJob, mode: "write" }],
    });

    expect(screen.getByText("Zaimportowane")).toBeVisible();
    expect(screen.queryByText("Poprawne")).not.toBeInTheDocument();
  });

  it("renders every status with a readable label, icon and semantic tone", () => {
    renderPanel({
      jobs: [
        statusJob(31, "queued"),
        statusJob(32, "running"),
        statusJob(33, "succeeded"),
        statusJob(34, "failed"),
        statusJob(35, "cancelled"),
        {
          ...statusJob(36, "running"),
          cancellationRequestedAt: "2026-07-17T10:02:00.000Z",
          cancellationRequested: true,
        },
      ],
    });

    for (const [label, tone] of [
      ["W kolejce", "queued"],
      ["W trakcie", "running"],
      ["Zakończony", "succeeded"],
      ["Nieudany", "failed"],
      ["Anulowany", "cancelled"],
      ["Anulowanie…", "cancelling"],
    ] as const) {
      const badge = screen.getByLabelText(`Status: ${label}`);
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveAttribute("data-status-tone", tone);
      expect(badge.querySelector("svg")).not.toBeNull();
    }
  });
});

const activeJob = {
  id: 21,
  source: "ising" as const,
  mode: "dry_run" as const,
  status: "running" as const,
  initiatorKind: "operator" as const,
  createdAt: "2026-07-17T10:00:00.000Z",
  startedAt: "2026-07-17T10:01:00.000Z",
  terminalAt: null,
  totalCount: 10,
  processedCount: 4,
  importedCount: 3,
  skippedCount: 1,
  errorCount: 0,
  safeErrorCode: null,
  safeErrorSummary: null,
  cancellationRequestedAt: null,
  cancellationRequested: false,
};

function statusJob(
  id: number,
  status: ImportAdminPageData["jobs"][number]["status"],
) {
  return {
    ...activeJob,
    id,
    status,
    terminalAt:
      status === "succeeded" || status === "failed" || status === "cancelled"
        ? "2026-07-17T10:03:00.000Z"
        : null,
  };
}

function pageData(overrides: Partial<ImportAdminPageData> = {}): ImportAdminPageData {
  return {
    jobs: [activeJob],
    capabilities: { canStartISing: true, canCancel: true },
    ...overrides,
  };
}

function renderPanel({
  jobs,
  capabilities,
  startWrite = vi.fn(),
  cancelJob = vi.fn(),
}: {
  jobs?: ImportAdminPageData["jobs"];
  capabilities?: ImportAdminPageData["capabilities"];
  startWrite?: () => Promise<{ kind: "success"; message: string }>;
  cancelJob?: (jobId: number) => Promise<{ kind: "success"; message: string }>;
} = {}) {
  const overrides: Partial<ImportAdminPageData> = {};
  if (jobs) {
    overrides.jobs = jobs;
  }
  if (capabilities) {
    overrides.capabilities = capabilities;
  }

  return render(
    <AdminImportsPanel
      data={pageData(overrides)}
      startDryRun={vi.fn()}
      startWrite={startWrite}
      cancelJob={cancelJob}
    />,
  );
}
