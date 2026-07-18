import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { EventSidebarBridge } from "@/components/operator/event-sidebar-context";
import { getDashboardOrganizationEventForAuthUser } from "@/server/operator-api/organizations";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { validateEventId } from "@/server/operator-api/validation";

export default async function DashboardEventLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string; eventId: string }>;
}) {
  const { organizationId, eventId } = await params;
  const eventIdValidation = validateEventId(eventId);
  if (!eventIdValidation.success) notFound();

  const session = await requireOperatorSession();
  const result = await getDashboardOrganizationEventForAuthUser({
    authUserId: session.authUser.id,
    organizationId,
    eventId: eventIdValidation.data,
  });
  if (!result) notFound();

  return (
    <EventSidebarBridge
      event={{ eventId: String(result.event.id), name: result.event.name }}
    >
      {children}
    </EventSidebarBridge>
  );
}
