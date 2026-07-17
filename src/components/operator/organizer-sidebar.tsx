"use client";

import {
  Building2Icon,
  CalendarDaysIcon,
  LayoutDashboardIcon,
  LockKeyholeIcon,
  PlusIcon,
  SettingsIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";

import { AppSidebar } from "@/components/app-shell/app-sidebar";
import type { AppNavigationGroup } from "@/components/app-shell/navigation";
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationPath,
  getDashboardOrganizationSettingsPath,
  getDashboardOrganizationTeamPath,
} from "@/lib/dashboard-routes";

import {
  DashboardOrganizationSwitcher,
  type DashboardOrganizationSwitcherItem,
} from "./dashboard-organization-switcher";

export type OrganizerSidebarOrganization = {
  id: number;
  name: string;
  organizationId: string;
  role: string;
};

export function getOrganizerNavigationGroups({
  organizationId,
  accountRoute,
}: {
  organizationId: string | null;
  accountRoute: boolean;
}): AppNavigationGroup[] {
  const panelGroup: AppNavigationGroup = {
    label: "Panel organizatora",
    items: [
      {
        href: getDashboardOrganizationsPath(),
        label: "Organizacje",
        icon: Building2Icon,
      },
      {
        href: getDashboardNewOrganizationPath(),
        label: "Nowa organizacja",
        icon: PlusIcon,
        exact: true,
      },
    ],
  };

  if (organizationId) {
    return [
      {
        label: "Organizacja",
        items: [
          {
            href: getDashboardOrganizationPath(organizationId),
            label: "Przegląd",
            icon: LayoutDashboardIcon,
            exact: true,
          },
          {
            href: getDashboardOrganizationEventsPath(organizationId),
            label: "Wydarzenia",
            icon: CalendarDaysIcon,
          },
          {
            href: getDashboardOrganizationTeamPath(organizationId),
            label: "Zespół",
            icon: UsersIcon,
          },
          {
            href: getDashboardOrganizationSettingsPath(organizationId),
            label: "Ustawienia",
            icon: SettingsIcon,
          },
        ],
      },
      panelGroup,
    ];
  }

  if (accountRoute) {
    return [
      {
        label: "Konto",
        items: [
          {
            href: "/account",
            label: "Profil",
            icon: UserRoundIcon,
          },
          {
            href: "/account/security",
            label: "Bezpieczeństwo",
            icon: LockKeyholeIcon,
          },
        ],
      },
      panelGroup,
    ];
  }

  return [panelGroup];
}

export function OrganizerSidebar({
  pathname,
  organization,
  organizations,
  operatorName,
  email,
  canAccessAdmin,
}: {
  pathname: string;
  organization: OrganizerSidebarOrganization | null;
  organizations: DashboardOrganizationSwitcherItem[];
  operatorName: string;
  email: string | null;
  canAccessAdmin: boolean;
}) {
  const groups = getOrganizerNavigationGroups({
    organizationId: organization?.organizationId ?? null,
    accountRoute: pathname.startsWith("/account"),
  });

  return (
    <AppSidebar
      ariaLabel="Nawigacja panelu organizatora"
      homeHref="/dashboard"
      contextLabel={organization?.name ?? "Panel organizatora"}
      groups={groups}
      pathname={pathname}
      managementTheme
      header={<DashboardOrganizationSwitcher organizations={organizations} />}
      user={{
        displayName: operatorName,
        initials: getInitials(operatorName),
        roleLabel: organization ? formatOrganizationRole(organization.role) : "Operator",
        email,
        canAccessAdmin,
      }}
    />
  );
}

export function formatOrganizationRole(role: string) {
  switch (role) {
    case "owner":
      return "Właściciel organizacji";
    case "manager":
      return "Menedżer organizacji";
    case "operator":
      return "Operator";
    case "viewer":
      return "Podgląd";
    default:
      return "Operator";
  }
}

function getInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pl-PL") ?? "")
    .join("");

  return initials || "PN";
}
