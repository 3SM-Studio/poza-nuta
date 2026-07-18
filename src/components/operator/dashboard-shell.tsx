"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  getDashboardNewOrganizationPath,
  getDashboardOrganizationsPath,
  getDashboardOrganizationEventsPath,
  getDashboardOrganizationSettingsPath,
  getDashboardOrganizationTeamPath,
  getDashboardProfileOnboardingPath,
  isDashboardNavigationLinkActive,
} from "@/lib/dashboard-routes";

import {
  OrganizerSidebar,
  type OrganizerSidebarOrganization,
} from "./organizer-sidebar";
import {
  EventSidebarProvider,
  useEventSidebarContext,
} from "./event-sidebar-context";

type DashboardShellProps = {
  children: ReactNode;
  organizations: OrganizerSidebarOrganization[];
  operatorName: string;
  email: string | null;
  canAccessAdmin: boolean;
};

export function DashboardShell({
  children,
  organizations,
  operatorName,
  email,
  canAccessAdmin,
}: DashboardShellProps) {
  return (
    <EventSidebarProvider>
      <DashboardShellContent
        organizations={organizations}
        operatorName={operatorName}
        email={email}
        canAccessAdmin={canAccessAdmin}
      >
        {children}
      </DashboardShellContent>
    </EventSidebarProvider>
  );
}

function DashboardShellContent({
  children,
  organizations,
  operatorName,
  email,
  canAccessAdmin,
}: DashboardShellProps) {
  const pathname = usePathname();
  const eventContext = useEventSidebarContext();
  const organizationId = getSelectedOrganizationId(pathname);
  const eventId = getSelectedEventId(pathname);
  const currentEvent =
    eventContext && eventContext.eventId === eventId ? eventContext : null;
  const currentOrganization =
    organizations.find(
      (organization) => organization.organizationId === organizationId,
    ) ?? null;
  const isAccountRoute = pathname.startsWith("/account");
  const layout = organizationId
    ? "organization"
    : isAccountRoute
      ? "account"
      : "simple";
  const title = getDashboardPageTitle(pathname, organizationId);

  return (
    <AppShell
      kind="dashboard"
      layout={layout}
      sidebar={
        <OrganizerSidebar
          pathname={pathname}
          organization={currentOrganization}
          event={
            eventId
              ? { eventId, name: currentEvent?.name ?? "Wydarzenie" }
              : null
          }
          organizations={organizations}
          operatorName={operatorName}
          email={email}
          canAccessAdmin={canAccessAdmin}
        />
      }
      section="Panel organizatora"
      title={title}
    >
      {children}
    </AppShell>
  );
}

function getSelectedEventId(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return segments[3] === "events" && segments[4]
    ? decodeURIComponent(segments[4])
    : null;
}

export function getDashboardPageTitle(
  pathname: string,
  organizationId: string | null,
) {
  if (organizationId) {
    return getOrganizationSectionLabel(pathname, organizationId);
  }

  if (pathname.startsWith("/account/security")) return "Bezpieczeństwo";
  if (pathname.startsWith("/account")) return "Konto";
  if (pathname === getDashboardNewOrganizationPath()) return "Nowa organizacja";
  if (pathname === getDashboardProfileOnboardingPath()) return "Profil";
  if (pathname.startsWith(getDashboardOrganizationsPath())) return "Organizacje";
  if (pathname.startsWith("/dashboard/settings")) return "Ustawienia wydarzenia";

  return "Panel";
}

function getOrganizationSectionLabel(pathname: string, organizationId: string) {
  if (
    isDashboardNavigationLinkActive(
      pathname,
      getDashboardOrganizationEventsPath(organizationId),
    )
  ) {
    return "Wydarzenia";
  }

  if (
    isDashboardNavigationLinkActive(
      pathname,
      getDashboardOrganizationTeamPath(organizationId),
    )
  ) {
    return "Zespół";
  }

  if (
    isDashboardNavigationLinkActive(
      pathname,
      getDashboardOrganizationSettingsPath(organizationId),
    )
  ) {
    return "Ustawienia";
  }

  return "Przegląd";
}

function getSelectedOrganizationId(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "dashboard" || segments[1] !== "org") return null;
  return segments[2] ? decodeURIComponent(segments[2]) : null;
}
