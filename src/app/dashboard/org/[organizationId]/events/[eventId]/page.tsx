import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EventOverview } from "@/components/operator/event-overview";
import { getDashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import { getDashboardOrganizationEventCompatibilityRedirectPath } from "@/lib/dashboard-routes";
import { resolveDashboardEventRouteForAuthUser } from "@/server/operator-api/event-route-compatibility";
import { getDashboardOrganizationEventForAuthUser } from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Wydarzenie | Poza Nutą",
};

export const dynamic = "force-dynamic";

export default async function OrganizationEventDetailPage({
  params,
}: {
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
    redirect(
      getDashboardOrganizationEventCompatibilityRedirectPath(
        routeResolution.organizationPublicId,
        routeResolution.event.publicId,
        "detail",
      ),
    );
  }

  const result = await getDashboardOrganizationEventForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: routeResolution.eventPublicId,
  });
  if (!result) notFound();

  if (eventId !== result.event.publicId) {
    redirect(
      getDashboardOrganizationEventCompatibilityRedirectPath(
        result.organization.publicId,
        result.event.publicId,
        "detail",
      ),
    );
  }

  const lifecycleStatus = getDashboardEventLifecycleStatus(result.event);

  return (
    <EventOverview
      overview={{
        organizationId: result.organization.publicId,
        role: result.organization.role,
        event: {
          publicId: result.event.publicId,
          lifecycle: lifecycleStatus,
          visibility: result.event.visibility,
          publishedAt: result.event.publishedAt,
          slug: result.event.slug,
          facebookUrl: result.event.facebookUrl,
          isActivePublicEvent: result.event.isActivePublicEvent,
          songRequestsEnabled: result.event.songRequestsEnabled,
          publicQueueEnabled: result.event.publicQueueEnabled,
          publicShowSongTitles: result.event.publicShowSongTitles,
        },
      }}
    />
  );
}
