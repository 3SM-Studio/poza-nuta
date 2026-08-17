import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EventQueuePanel } from "@/components/operator/event-queue-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <div className="grid min-w-0 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Kolejka wydarzenia</CardTitle>
          <CardDescription>
            Zgłoszenia przypisane wyłącznie do tego wydarzenia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&_div]:rounded-md [&_div]:bg-muted/40 [&_div]:p-3 [&_dt]:text-xs [&_dt]:font-semibold [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold">
            <div>
              <dt>Publiczna kolejka</dt>
              <dd>
                {result.event.publicQueueEnabled ? "Włączona" : "Wyłączona"}
              </dd>
            </div>
            <div>
              <dt>Uprawnienia</dt>
              <dd>
                {result.canManage ? "Zarządzanie kolejką" : "Tylko podgląd"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <EventQueuePanel
        organizationId={result.organization.publicId}
        eventId={result.event.publicId}
        realtimeEventId={result.event.id}
        canManage={result.canManage}
        initialItems={result.items.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          startedAt: item.startedAt?.toISOString() ?? null,
          completedAt: item.completedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
