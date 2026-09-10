import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EventSessionAccessPanel } from "@/components/operator/event-session-access-panel";
import { GeneralJoinAccessPanel } from "@/components/operator/general-join-access-panel";
import { getDashboardEventLifecycleStatus } from "@/lib/dashboard-event-lifecycle";
import { getDashboardOrganizationEventCompatibilityRedirectPath } from "@/lib/dashboard-routes";
import { tryBuildCanonicalSiteUrl } from "@/server/canonical-site-origin";
import { resolveDashboardEventRouteForAuthUser } from "@/server/operator-api/event-route-compatibility";
import {
  canShareDashboardOrganizationEvent,
  getDashboardOrganizationEventSessionAccessForAuthUser,
} from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";

export const metadata: Metadata = {
  title: "Udostępnij wydarzenie | Poza Nutą",
};

export const dynamic = "force-dynamic";

type OrganizationEventSharePageProps = {
  params: Promise<{ organizationId: string; eventId: string }>;
};

export default async function OrganizationEventSharePage({
  params,
}: OrganizationEventSharePageProps) {
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
        "share",
      ),
    );
  }

  const result = await getDashboardOrganizationEventSessionAccessForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: routeResolution.eventPublicId,
  });

  if (!result || !canShareDashboardOrganizationEvent(result.organization.role)) {
    notFound();
  }

  if (eventId !== result.event.publicId) {
    redirect(
      getDashboardOrganizationEventCompatibilityRedirectPath(
        result.organization.publicId,
        result.event.publicId,
        "share",
      ),
    );
  }

  const lifecycleStatus = getDashboardEventLifecycleStatus(result.event);
  const sessionUrl = tryBuildCanonicalSiteUrl(
    `/s/${result.event.publicToken}`,
  );
  const generalJoinUrl = tryBuildCanonicalSiteUrl("/join");

  return (
    <div className="grid min-w-0 gap-4">
      <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          Kod i QR prowadzą wyłącznie do kanonicznej sesji wydarzenia.
        </p>
        <p className="mt-1.5">
          Ogólny kod wejścia prowadzi do formularza /join, w którym uczestnik
          sam wpisuje kod właściwego wydarzenia.
        </p>
      </div>

      <EventSessionAccessPanel
        sessionCode={result.event.sessionCode}
        sessionUrl={sessionUrl}
        isClosed={
          lifecycleStatus === "closed" || lifecycleStatus === "cancelled"
        }
      />

      <GeneralJoinAccessPanel joinUrl={generalJoinUrl} />
    </div>
  );
}
