export const platformPermissions = [
  "admin.access",
  "catalog_import_history.read",
  "imports.ising.start",
  "imports.karafun.execute",
  "imports.cancel",
  "users.read",
  "users.suspend_non_owner",
  "users.suspend_owner",
  "platform_members.mutate_non_owner",
  "platform_members.grant_owner",
  "platform_members.mutate_owner",
  "organizations.read",
  "audit.read",
  "audit.export",
  "system.critical_settings",
  "database.execute",
] as const;

export type PlatformPermission = (typeof platformPermissions)[number];
export type PlatformRole =
  (typeof import("@/db/schema").platformMemberRoleValues)[number];
export type PlatformPermissionDecision =
  | "allow"
  | "deny"
  | "conditional"
  | "deferred";

const platformRolePolicy = {
  platform_owner: {
    "admin.access": "allow",
    "catalog_import_history.read": "allow",
    "imports.ising.start": "allow",
    "imports.karafun.execute": "allow",
    "imports.cancel": "allow",
    "users.read": "allow",
    "users.suspend_non_owner": "allow",
    "users.suspend_owner": "conditional",
    "platform_members.mutate_non_owner": "allow",
    "platform_members.grant_owner": "allow",
    "platform_members.mutate_owner": "conditional",
    "organizations.read": "allow",
    "audit.read": "allow",
    "audit.export": "deny",
    "system.critical_settings": "deferred",
    "database.execute": "deny",
  },
  platform_admin: {
    "admin.access": "allow",
    "catalog_import_history.read": "allow",
    "imports.ising.start": "allow",
    "imports.karafun.execute": "allow",
    "imports.cancel": "allow",
    "users.read": "allow",
    "users.suspend_non_owner": "allow",
    "users.suspend_owner": "deny",
    "platform_members.mutate_non_owner": "deny",
    "platform_members.grant_owner": "deny",
    "platform_members.mutate_owner": "deny",
    "organizations.read": "allow",
    "audit.read": "allow",
    "audit.export": "deny",
    "system.critical_settings": "deny",
    "database.execute": "deny",
  },
  support: {
    "admin.access": "allow",
    "catalog_import_history.read": "allow",
    "imports.ising.start": "deny",
    "imports.karafun.execute": "deny",
    "imports.cancel": "deny",
    "users.read": "allow",
    "users.suspend_non_owner": "deny",
    "users.suspend_owner": "deny",
    "platform_members.mutate_non_owner": "deny",
    "platform_members.grant_owner": "deny",
    "platform_members.mutate_owner": "deny",
    "organizations.read": "allow",
    "audit.read": "allow",
    "audit.export": "deny",
    "system.critical_settings": "deny",
    "database.execute": "deny",
  },
} as const satisfies Record<
  PlatformRole,
  Record<PlatformPermission, PlatformPermissionDecision>
>;

export function getPlatformPermissionDecision(
  role: PlatformRole,
  permission: PlatformPermission,
) {
  return platformRolePolicy[role][permission];
}

export function hasPlatformPermission(
  role: PlatformRole,
  permission: PlatformPermission,
) {
  return getPlatformPermissionDecision(role, permission) === "allow";
}
