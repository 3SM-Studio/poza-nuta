import { describe, expect, it, vi } from "vitest";

import {
  loadPlatformAdminOverviewWithDependencies,
  type PlatformAdminOverviewMetrics,
} from "@/server/platform-admin/overview-core";
import {
  SERVER_STEP_TIMEOUT_MS,
  ServerStepTimeoutError,
} from "@/server/runtime-diagnostics";

const metrics: PlatformAdminOverviewMetrics = {
  activeOperators: 12,
  eligibleOwners: 2,
  activePlatformMemberships: {
    platform_owner: 2,
    platform_admin: 3,
    support: 4,
  },
  activeWorkspaces: 5,
  catalogSongs: 600,
  activePublicEvents: 7,
};

describe("platform admin overview service", () => {
  it("repeats authorization before reading metrics", async () => {
    const calls: string[] = [];
    const telemetry = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      await expect(
        loadPlatformAdminOverviewWithDependencies({
          requireAccess: async () => {
            calls.push("guard");
          },
          readMetrics: async () => {
            calls.push("metrics");
            return metrics;
          },
        }),
      ).resolves.toEqual(metrics);

      expect(calls).toEqual(["guard", "metrics"]);
      expect(telemetry.mock.calls.map(([entry]) => entry)).toContainEqual(
        expect.stringContaining('"operation":"platform-admin.overview.metrics","phase":"success","operation_duration_ms":'),
      );
    } finally {
      telemetry.mockRestore();
    }
  });

  it("does not query metrics after authorization failure", async () => {
    const readMetrics = vi.fn(async () => metrics);

    await expect(
      loadPlatformAdminOverviewWithDependencies({
        requireAccess: async () => {
          throw new Error("denied");
        },
        readMetrics,
      }),
    ).rejects.toThrow("denied");

    expect(readMetrics).not.toHaveBeenCalled();
  });

  it("bounds a metrics read that never resolves after authorization", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const telemetry = vi.spyOn(console, "info").mockImplementation(() => {});
    const readMetrics = vi.fn(() => new Promise<PlatformAdminOverviewMetrics>(() => {}));

    try {
      const result = loadPlatformAdminOverviewWithDependencies({
        requireAccess: async () => undefined,
        readMetrics,
      });
      const rejection = expect(result).rejects.toBeInstanceOf(ServerStepTimeoutError);

      await vi.advanceTimersByTimeAsync(SERVER_STEP_TIMEOUT_MS);
      await rejection;
      expect(readMetrics).toHaveBeenCalledOnce();
      expect(telemetry.mock.calls.map(([entry]) => entry)).toContainEqual(
        expect.stringContaining('"operation":"platform-admin.overview.metrics","phase":"failure"'),
      );
    } finally {
      log.mockRestore();
      telemetry.mockRestore();
      vi.useRealTimers();
    }
  });

  it("propagates a metrics infrastructure failure", async () => {
    const failure = new Error("database unavailable");
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        loadPlatformAdminOverviewWithDependencies({
          requireAccess: async () => undefined,
          readMetrics: async () => {
            throw failure;
          },
        }),
      ).rejects.toBe(failure);
    } finally {
      log.mockRestore();
    }
  });

  it("returns only the accepted aggregate contract", () => {
    expect(Object.keys(metrics).sort()).toEqual([
      "activeOperators",
      "activePlatformMemberships",
      "activePublicEvents",
      "activeWorkspaces",
      "catalogSongs",
      "eligibleOwners",
    ]);
    expect(JSON.stringify(metrics)).not.toMatch(
      /email|authUserId|suspensionReason|import|audit|workspaceMembership/i,
    );
  });
});
