"use client";

import {
  Building2Icon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  LayoutDashboardIcon,
  ListMusicIcon,
  LockKeyholeIcon,
  PlusIcon,
  QrCodeIcon,
  SettingsIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";

import { AppSidebar } from "@/components/app-shell/app-sidebar";
import type { AppNavigationGroup } from "@/components/app-shell/navigation";
import {
  canShareDashboardOrganizationEvent,
  type DashboardOrganizationRole,
} from "@/lib/dashboard-organization-access";
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardOrganizationEventPath,
  getDashboardOrganizationEventQueuePath,
  getDashboardOrganizationEventSettingsPath,
  getDashboardOrganizationEventSharePath,
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
  role: DashboardOrganizationRole;
};

export function getOrganizerNavigationGroups({
  organizationId,
  accountRoute,
  event,
}: {
  organizationId: string | null;
  accountRoute: boolean;
  event?: {
    eventId: string;
    name: string;
    role: DashboardOrganizationRole;
  } | null;
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
    const organizationGroups: AppNavigationGroup[] = [
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

    if (!event) return organizationGroups;

    return [
      {
        label: "Wydarzenie",
        contextLabel: event.name,
        ariaLabel: "Nawigacja wydarzenia",
        items: [
          {
            href: getDashboardOrganizationEventPath(
              organizationId,
              event.eventId,
            ),
            label: "Przegląd",
            icon: CalendarDaysIcon,
            exact: true,
          },
          {
            href: getDashboardOrganizationEventQueuePath(
              organizationId,
              event.eventId,
            ),
            label: "Kolejka",
            icon: ListMusicIcon,
          },
          ...(canShareDashboardOrganizationEvent(event.role)
            ? [
                {
                  href: getDashboardOrganizationEventSharePath(
                    organizationId,
                    event.eventId,
                  ),
                  label: "Link i QR",
                  icon: QrCodeIcon,
                },
              ]
            : []),
          {
            href: getDashboardOrganizationEventSettingsPath(
              organizationId,
              event.eventId,
            ),
            label: "Ustawienia",
            icon: SettingsIcon,
          },
          {
            href: getDashboardOrganizationEventsPath(organizationId),
            label: "Powrót do wydarzeń",
            icon: ChevronLeftIcon,
            exact: true,
          },
        ],
      },
      ...organizationGroups,
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
  event,
  organizations,
  operatorName,
  email,
  canAccessAdmin,
}: {
  pathname: string;
  organization: OrganizerSidebarOrganization | null;
  event: { eventId: string; name: string } | null;
  organizations: DashboardOrganizationSwitcherItem[];
  operatorName: string;
  email: string | null;
  canAccessAdmin: boolean;
}) {
  const groups = getOrganizerNavigationGroups({
    organizationId: organization?.organizationId ?? null,
    accountRoute: pathname.startsWith("/account"),
    event:
      event && organization
        ? { ...event, role: organization.role }
        : null,
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
