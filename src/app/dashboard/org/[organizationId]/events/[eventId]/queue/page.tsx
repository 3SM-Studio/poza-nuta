import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EventQueuePanel } from "@/components/operator/event-queue-panel";
import { getDashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import { getDashboardOrganizationEventCompatibilityRedirectPath } from "@/lib/dashboard-routes";
import { getDashboardOrganizationEventQueueForAuthUser } from "@/server/operator-api/event-queue";
import { resolveDashboardEventRouteForAuthUser } from "@/server/operator-api/event-route-compatibility";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Kolejka wydarzenia | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventQueuePageProps = {
  params: Promise<{
    organizationId: string;
    eventId: string;
  }>;
};

export default async function OrganizationEventQueuePage({
  params,
}: OrganizationEventQueuePageProps) {
  const { organizationId, eventId } = await params;
  const session = await requireOperatorSession();
  const routeResolution = await resolveDashboardEventRouteForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    routeEventId: eventId,
  });
  if (routeResolution.kind === "not_found") notFound();
  if (routeResolution.kind === "legacy_redirect") {
    redirect(
      getDashboardOrganizationEventCompatibilityRedirectPath(
        routeResolution.organizationPublicId,
        routeResolution.event.publicId,
        "queue",
      ),
    );
  }

  const result = await getDashboardOrganizationEventQueueForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: routeResolution.eventPublicId,
  });

  if (!result) {
    notFound();
  }

  if (eventId !== result.event.publicId) {
    redirect(
      getDashboardOrganizationEventCompatibilityRedirectPath(
        result.organization.publicId,
        result.event.publicId,
        "queue",
      ),
    );
  }

  return (
    <EventQueuePanel
      organizationId={result.organization.publicId}
      eventId={result.event.publicId}
      realtimeEventId={result.event.id}
      canManage={result.canManage}
      lifecycle={getDashboardEventLifecycleStatus(result.event)}
      publicQueueEnabled={result.event.publicQueueEnabled}
      initialItems={result.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        startedAt: item.startedAt?.toISOString() ?? null,
        completedAt: item.completedAt?.toISOString() ?? null,
      }))}
    />
  );
}
