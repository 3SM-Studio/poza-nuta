import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SessionRequestPage } from "@/components/public/session-request-page";
import type { SessionEvent } from "@/components/public/session-api";
import styles from "@/components/public/public.module.css";
import { resolveSessionEventAccess } from "@/server/session-api/service";
import type { PublicSessionEvent } from "@/server/session-api/service";

export const metadata: Metadata = {
  title: "Sesja karaoke | Poza Nutą",
};

export const dynamic = "force-dynamic";

type SessionPageProps = {
  params: Promise<{
    code: string;
  }>;
};

export default async function SessionPage({ params }: SessionPageProps) {
  const { code } = await params;
  const access = await resolveSessionEventAccess(code);
  const event = access.status === "invalid" ? null : access.event;

  return (
    <main className={styles.publicPage}>
      <div className={styles.publicShell}>
        <header className={styles.publicHeader}>
          <Link
            className={styles.brand}
            href="/"
            aria-label="Przejdź na stronę główną"
          >
            <Image
              className={styles.brandLogo}
              src="/brand/poza_nuta_logo-white.png"
              alt="Poza Nutą"
              width={1254}
              height={1254}
            />
          </Link>
          <h1>{event?.name ?? "Sesja karaoke"}</h1>
          {event?.venue ? <p>{event.venue}</p> : null}
        </header>

        {access.status === "active" ? (
          <SessionRequestPage
            code={code}
            event={serializeSessionEvent(access.event)}
          />
        ) : (
          <section className={styles.publicSection}>
            <h2>Link sesji</h2>
            <div className={styles.errorMessage} role="alert">
              {getSessionAccessMessage(access.status)}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function getSessionAccessMessage(status: ResolveStatus) {
  switch (status) {
    case "scheduled":
      return "Wydarzenie jeszcze się nie rozpoczęło.";
    case "closed":
      return "Zgłoszenia są już zamknięte.";
    case "disabled":
      return "Publiczne zgłoszenia są wyłączone.";
    default:
      return "Link sesji jest nieprawidłowy albo wygasł.";
  }
}

function serializeSessionEvent(
  event: PublicSessionEvent,
): SessionEvent {
  return {
    id: event.id,
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

type ResolveStatus = Awaited<
  ReturnType<typeof resolveSessionEventAccess>
>["status"];
