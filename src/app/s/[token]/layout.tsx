import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { ParticipantJoinGate } from "@/components/public/participant-join-gate";
import { SessionRequestPage } from "@/components/public/session-request-page";
import { SessionStateAlert } from "@/components/public/session-state-alert";
import type { SessionEvent } from "@/components/public/session-api";
import { canUseSessionPublicQueue, canUseSessionSongRequests } from "@/lib/session-capabilities";
import { consumeSessionRequestRateLimit } from "@/server/session-api/rate-limit";
import { PARTICIPANT_CREDENTIAL_COOKIE } from "@/server/session-api/participant-credential";
import { getPublicSessionPageData, type PublicSessionEvent } from "@/server/session-api/service";
import { isTransientInfrastructureError, traceServerStep } from "@/server/runtime-diagnostics";

export const metadata: Metadata = {
  title: "Sesja karaoke | Poza Nutą",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicSessionLayout({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const rateLimit = consumeSessionRequestRateLimit(await headers(), "page");
  let pageData: Awaited<ReturnType<typeof getPublicSessionPageData>> | null = null;
  let serviceUnavailable = false;

  if (rateLimit.allowed) {
    try {
      const participantCredential = (await cookies()).get(PARTICIPANT_CREDENTIAL_COOKIE)?.value;
      pageData = await traceServerStep("session.page", "loadSession", () =>
        getPublicSessionPageData(token, participantCredential, "interactive"),
      );
    } catch (error) {
      if (!isTransientInfrastructureError(error)) throw error;
      serviceUnavailable = true;
    }
  }

  const access = serviceUnavailable
    ? ({ status: "service_unavailable" } as const)
    : pageData?.access ?? ({ status: "rate_limited" } as const);
  if (access.status === "invalid") notFound();

  if (access.status !== "active") {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <section className="mx-auto w-full max-w-lg px-4 pt-[max(2rem,env(safe-area-inset-top))] sm:px-8">
          <h2 className="mb-3 text-xl font-bold tracking-[-0.035em]">Sesja karaoke</h2>
          <SessionStateAlert kind={access.status} />
        </section>
      </main>
    );
  }

  const canUseSession = canUseSessionSongRequests(access.event) || canUseSessionPublicQueue(access.event);
  const participant = pageData?.participant ?? null;

  if (canUseSession && !participant) {
    return <ParticipantJoinGate eventName={access.event.name} sessionToken={token} />;
  }

  return (
    <SessionRequestPage
      event={serializeSessionEvent(access.event)}
      participantDisplayName={participant?.displayName}
      sessionToken={token}
      discovery={pageData?.discovery ?? undefined}
    />
  );
}

function serializeSessionEvent(event: PublicSessionEvent): SessionEvent {
  return {
    name: event.name,
    venue: event.venue,
    startsAt: event.startsAt.toISOString(),
    status: event.status,
    publicQueueEnabled: event.publicQueueEnabled,
    songRequestsEnabled: event.songRequestsEnabled,
    publicShowSongTitles: event.publicShowSongTitles,
    autoCloseAt: event.autoCloseAt?.toISOString() ?? null,
    endsAt: event.endsAt.toISOString(),
    closedAt: event.closedAt?.toISOString() ?? null,
  };
}
