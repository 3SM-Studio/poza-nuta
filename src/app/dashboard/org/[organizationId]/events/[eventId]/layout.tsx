import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { EventSidebarBridge } from "@/components/operator/event-sidebar-context";
import { resolveDashboardEventRouteForAuthUser } from "@/server/operator-api/event-route-compatibility";
import { getDashboardOrganizationEventForAuthUser } from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";

export default async function DashboardEventLayout({
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

  return (
    <EventSidebarBridge
      event={{ eventId: result.event.publicId, name: result.event.name }}
    >
      {children}
    </EventSidebarBridge>
  );
}
