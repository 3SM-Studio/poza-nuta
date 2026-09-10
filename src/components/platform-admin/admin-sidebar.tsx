"use client";

import { DatabaseIcon, LayoutDashboardIcon } from "lucide-react";

import { AppSidebar } from "@/components/app-shell/app-sidebar";
import type { AppNavigationGroup } from "@/components/app-shell/navigation";
import type { AdminActorViewModel } from "@/server/platform-admin/page-access-core";
import {
  hasPlatformPermission,
  type PlatformPermission,
  type PlatformRole,
} from "@/server/platform-admin/policy";

const roleLabels: Record<PlatformRole, string> = {
  platform_owner: "Właściciel platformy",
  platform_admin: "Administrator platformy",
  support: "Wsparcie",
};

const adminNavigation = [
  {
    href: "/admin",
    label: "Overview",
    icon: LayoutDashboardIcon,
    exact: true,
    permission: "admin.access",
  },
  {
    href: "/admin/imports",
    label: "Importy",
    icon: DatabaseIcon,
    permission: "catalog_import_history.read",
  },
] as const satisfies ReadonlyArray<{
  href: string;
  label: string;
  icon: typeof LayoutDashboardIcon;
  exact?: boolean;
  permission: PlatformPermission;
}>;

export function getAdminNavigationGroups(role: PlatformRole): AppNavigationGroup[] {
  return [
    {
      label: "Administracja",
      items: adminNavigation
        .filter((item) => hasPlatformPermission(role, item.permission))
        .map((item) => ({
          href: item.href,
          label: item.label,
          icon: item.icon,
          exact: "exact" in item ? item.exact : undefined,
        })),
    },
  ];
}

export function AdminSidebar({
  actor,
  pathname,
}: {
  actor: AdminActorViewModel;
  pathname: string;
}) {
  return (
    <AppSidebar
      ariaLabel="Nawigacja administratora"
      homeHref="/admin"
      contextLabel="Administracja"
      groups={getAdminNavigationGroups(actor.role)}
      pathname={pathname}
      managementTheme
      user={{
        displayName: actor.displayName,
        initials: actor.initials,
        roleLabel: roleLabels[actor.role],
        canAccessAdmin: true,
      }}
    />
  );
}
