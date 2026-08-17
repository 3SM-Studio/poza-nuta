import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { SessionRequestPage } from "@/components/public/session-request-page";
import { ParticipantJoinGate } from "@/components/public/participant-join-gate";
import { SessionStateAlert } from "@/components/public/session-state-alert";
import type { SessionEvent } from "@/components/public/session-api";
import styles from "@/components/public/public.module.css";
import { consumeSessionRequestRateLimit } from "@/server/session-api/rate-limit";
import { PARTICIPANT_CREDENTIAL_COOKIE } from "@/server/session-api/participant-credential";
import {
  getPublicSessionParticipant,
  resolvePublicSessionEventAccess,
  type PublicSessionEvent,
} from "@/server/session-api/service";
import {
  canUseSessionPublicQueue,
  canUseSessionSongRequests,
} from "@/lib/session-capabilities";

export const metadata: Metadata = {
  title: "Sesja karaoke | Poza Nutą",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const rateLimit = consumeSessionRequestRateLimit(await headers(), "page");
  const access = rateLimit.allowed
    ? await resolvePublicSessionEventAccess(token)
    : ({ status: "rate_limited" } as const);
  const event =
    access.status === "invalid" || access.status === "rate_limited"
      ? null
      : access.event;

  if (access.status === "invalid") {
    notFound();
  }

  const participant =
    access.status === "active" &&
    (canUseSessionSongRequests(access.event) ||
      canUseSessionPublicQueue(access.event))
      ? await getPublicSessionParticipant(
          token,
          (await cookies()).get(PARTICIPANT_CREDENTIAL_COOKIE)?.value,
        )
      : null;

  return (
    <main className={styles.publicPage}>
      <div className={styles.publicShell}>
        <header className={styles.publicHeader}>
          <Link className={styles.brand} href="/" aria-label="Strona główna">
            <Image
              className={styles.brandLogo}
              src="/brand/poza_nuta_logo-white.png"
              alt="Poza Nutą"
              width={1254}
              height={1254}
              loading="eager"
            />
          </Link>
          <h1>{event?.name ?? "Sesja karaoke"}</h1>
          {event?.venue ? <p>{event.venue}</p> : null}
        </header>

        {access.status === "active" ? (
          canUseSessionSongRequests(access.event) ||
          canUseSessionPublicQueue(access.event) ? (
            participant ? (
              <SessionRequestPage
                sessionToken={token}
                event={serializeSessionEvent(access.event)}
                participantDisplayName={participant.displayName}
              />
            ) : (
              <ParticipantJoinGate sessionToken={token} />
            )
          ) : (
            <SessionRequestPage
              sessionToken={token}
              event={serializeSessionEvent(access.event)}
            />
          )
        ) : (
          <section className={styles.publicSection}>
            <h2>Sesja karaoke</h2>
            <SessionStateAlert kind={access.status} />
          </section>
        )}
      </div>
    </main>
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
