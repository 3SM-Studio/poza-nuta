import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";

import { EventPageSkeleton } from "@/components/operator/dashboard-skeletons";
import { EventSidebarBridge } from "@/components/operator/event-sidebar-context";
import {
  EventWorkspaceShell,
  type EventWorkspaceModel,
} from "@/components/operator/event-workspace-shell";
import { getDashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import { resolveDashboardEventRouteForAuthUser } from "@/server/operator-api/event-route-compatibility";
import { getDashboardOrganizationEventForAuthUser } from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";

export default function DashboardEventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string; eventId: string }>;
}) {
  return (
    <Suspense fallback={<EventPageSkeleton />}>
      <DashboardEventLayoutContent params={params}>
        {children}
      </DashboardEventLayoutContent>
    </Suspense>
  );
}

async function DashboardEventLayoutContent({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string; eventId: string }>;
}) {
  const { organizationId, eventId } = await params;
  const session = await requireOperatorSession();
  const routeResolution = await resolveDashboardEventRouteForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    routeEventId: eventId,
  });
  if (routeResolution.kind === "not_found") notFound();

  if (routeResolution.kind === "legacy_redirect") {
    return (
      <EventSidebarBridge
        event={{
          eventId: routeResolution.event.publicId,
          name: routeResolution.event.name,
        }}
      >
        {children}
      </EventSidebarBridge>
    );
  }

  const result = await getDashboardOrganizationEventForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: routeResolution.eventPublicId,
  });
  if (!result) notFound();

  const workspace: EventWorkspaceModel = {
    event: {
      publicId: result.event.publicId,
      name: result.event.name,
      venue: result.event.venue,
      city: result.event.city,
      startsAt: result.event.startsAt,
      closesAt: result.event.autoCloseAt ?? result.event.endsAt,
      lifecycle: getDashboardEventLifecycleStatus(result.event),
      visibility: result.event.visibility,
      slug: result.event.slug,
    },
  };

  return (
    <EventSidebarBridge
      event={{ eventId: result.event.publicId, name: result.event.name }}
    >
      <EventWorkspaceShell workspace={workspace}>
        {children}
      </EventWorkspaceShell>
    </EventSidebarBridge>
  );
}
