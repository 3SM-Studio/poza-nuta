import { notFound } from "next/navigation";
import { EventParticipantsPanel } from "@/components/operator/event-participants-panel";
import { listEventParticipants } from "@/server/operator-api/event-participants";
import { requireOperatorSession } from "@/server/operator-api/supabase-session";
import { getDashboardOrganizationEventForAuthUser } from "@/server/operator-api/organizations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Uczestnicy wydarzenia | Poza Nutą" };

export default async function EventParticipantsPage({ params }: {
  params: Promise<{ organizationId: string; eventId: string }>;
}) {
  const { organizationId, eventId } = await params;
  const session = await requireOperatorSession();
  const context = await getDashboardOrganizationEventForAuthUser({ authUserId: session.authUser.id, organizationId, eventId });
  if (!context) notFound();
  const result = await listEventParticipants({ authUserId: session.authUser.id, organizationId, eventId });
  return <EventParticipantsPanel organizationId={organizationId} eventId={eventId} initialData={{ ...result, items: result.items.map((item) => ({ ...item, joinedAt: item.joinedAt.toISOString() })) }} />;
}
