import type { PlatformRole } from "./policy";

export type PlatformAdminOverviewMetrics = {
  activeOperators: number;
  eligibleOwners: number;
  activePlatformMemberships: Record<PlatformRole, number>;
  activeWorkspaces: number;
  catalogSongs: number;
  activePublicEvents: number;
};

type PlatformAdminOverviewDependencies = {
  requireAccess: () => Promise<unknown>;
  readMetrics: () => Promise<PlatformAdminOverviewMetrics>;
};

export async function loadPlatformAdminOverviewWithDependencies(
  dependencies: PlatformAdminOverviewDependencies,
) {
  await dependencies.requireAccess();
  return dependencies.readMetrics();
}
