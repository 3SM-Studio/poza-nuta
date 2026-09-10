import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { ParticipantJoinGate } from "@/components/public/participant-join-gate";
import { SongDiscoveryPage } from "@/components/public/song-discovery-page";
import { SessionStateAlert } from "@/components/public/session-state-alert";
import styles from "@/components/public/public.module.css";
import { canUseSessionSongRequests } from "@/lib/session-capabilities";
import { consumeSessionRequestRateLimit } from "@/server/session-api/rate-limit";
import { PARTICIPANT_CREDENTIAL_COOKIE } from "@/server/session-api/participant-credential";
import { getPublicSessionPageData } from "@/server/session-api/service";
import {
  isTransientInfrastructureError,
  traceServerStep,
} from "@/server/runtime-diagnostics";

export const metadata: Metadata = {
  title: "Katalog piosenek | Poza Nutą",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicSessionSongsPage({
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
      const participantCredential = (await cookies()).get(
        PARTICIPANT_CREDENTIAL_COOKIE,
      )?.value;
      pageData = await traceServerStep(
        "session.songs.page",
        "loadSession",
        () =>
          getPublicSessionPageData(
            token,
            participantCredential,
            "song_requests",
          ),
      );
    } catch (error) {
      if (!isTransientInfrastructureError(error)) throw error;
      serviceUnavailable = true;
    }
  }

  const access = serviceUnavailable
    ? ({ status: "service_unavailable" } as const)
    : pageData?.access ?? ({ status: "rate_limited" } as const);
  const event =
    access.status === "invalid" ||
    access.status === "rate_limited" ||
    access.status === "service_unavailable"
      ? null
      : access.event;

  if (access.status === "invalid") notFound();

  const canBrowseSongs =
    access.status === "active" && canUseSessionSongRequests(access.event);
  const participant = pageData?.participant ?? null;
  const discovery = pageData?.discovery ?? null;

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
          <h1>{event?.name ?? "Katalog piosenek"}</h1>
          {event?.venue ? <p>{event.venue}</p> : null}
        </header>

        {access.status !== "active" ? (
          <section className={styles.publicSection}>
            <h2>Katalog piosenek</h2>
            <SessionStateAlert kind={access.status} />
          </section>
        ) : !canBrowseSongs ? (
          <section className={styles.publicSection}>
            <h2>Katalog piosenek</h2>
            <p className={styles.inlineMessage}>
              Publiczne zgłoszenia piosenek są wyłączone dla tej sesji.
            </p>
            <Link className={styles.queueLink} href={`/s/${encodeURIComponent(token)}`}>
              Wróć do wydarzenia
            </Link>
          </section>
        ) : !participant ? (
          <ParticipantJoinGate sessionToken={token} />
        ) : discovery ? (
          <SongDiscoveryPage sessionToken={token} discovery={discovery} />
        ) : null}
      </div>
    </main>
  );
}
