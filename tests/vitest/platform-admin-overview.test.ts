import { describe, expect, it, vi } from "vitest";

import {
  loadPlatformAdminOverviewWithDependencies,
  type PlatformAdminOverviewMetrics,
} from "@/server/platform-admin/overview-core";

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
