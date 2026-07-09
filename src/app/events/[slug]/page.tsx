import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/public/public.module.css";
import { formatWarsawDateTime } from "@/lib/warsaw-time";
import { PublicApiError } from "@/server/public-api/errors";
import { getPublicEventBySlug } from "@/server/public-api/service";

export const dynamic = "force-dynamic";

type PublicEventPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateMetadata({
  params,
}: PublicEventPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const event = await getPublicEventBySlug(slug, "public.events.metadata");

    return {
      title: `${event.name} | Poza Nutą`,
    };
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) {
      return {
        title: "Wydarzenie | Poza Nutą",
      };
    }

    throw error;
  }
}

export default async function PublicEventPage({ params }: PublicEventPageProps) {
  const { slug } = await params;
  const event = await loadPublicEvent(slug);

  return (
    <main className={styles.publicPage}>
      <div className={styles.eventShell}>
        <header className={styles.eventHeader}>
          <Link className={styles.brand} href="/" aria-label="Poza Nutą">
            <Image
              className={styles.brandLogo}
              src="/brand/poza_nuta_logo-white.png"
              alt="Poza Nutą"
              width={1254}
              height={1254}
            />
          </Link>
          <p className={styles.statusPill}>{formatPublicStatus(event.publicStatus)}</p>
          <h1>{event.name}</h1>
        </header>

        <section className={styles.eventSummary} aria-label="Szczegóły wydarzenia">
          <dl className={styles.eventDetails}>
            <div>
              <dt>Start</dt>
              <dd>{formatDateTime(event.startsAt)}</dd>
            </div>
            <div>
              <dt>Koniec</dt>
              <dd>{event.endsAt ? formatDateTime(event.endsAt) : "Do zamknięcia"}</dd>
            </div>
            <div>
              <dt>Miejsce</dt>
              <dd>{event.venueName ?? "Nie podano"}</dd>
            </div>
            <div>
              <dt>Miasto</dt>
              <dd>{event.city ?? "Nie podano"}</dd>
            </div>
            <div>
              <dt>Zgłoszenia</dt>
              <dd>{event.requestsEnabled ? "Otwarte" : "Zamknięte"}</dd>
            </div>
            <div>
              <dt>Kolejka publiczna</dt>
              <dd>{event.publicQueueEnabled ? "Włączona" : "Wyłączona"}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.publicSection}>
          <h2>{getStateHeading(event.publicStatus)}</h2>
          <p className={styles.inlineMessage}>
            {getStateDescription(event.publicStatus, event.requestsEnabled)}
          </p>
          <div className={styles.eventActions}>
            <Link className={styles.secondaryButton} href="/">
              Formularz karaoke
            </Link>
            {event.facebookUrl ? (
              <a
                className={styles.secondaryButton}
                href={event.facebookUrl}
                rel="noreferrer"
                target="_blank"
              >
                Facebook
              </a>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

async function loadPublicEvent(slug: string) {
  try {
    return await getPublicEventBySlug(slug, "public.events.page");
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) {
      notFound();
    }

    throw error;
  }
}

function formatDateTime(value: string) {
  return formatWarsawDateTime(new Date(value));
}

function formatPublicStatus(status: string) {
  switch (status) {
    case "live":
      return "Trwa teraz";
    case "ended":
      return "Zakończone";
    default:
      return "Nadchodzące";
  }
}

function getStateHeading(status: string) {
  switch (status) {
    case "live":
      return "Wydarzenie trwa";
    case "ended":
      return "Wydarzenie zakończone";
    default:
      return "Wydarzenie nadchodzi";
  }
}

function getStateDescription(status: string, requestsEnabled: boolean) {
  if (status === "ended") {
    return "To wydarzenie jest już zakończone, więc publiczne zgłoszenia są zamknięte.";
  }

  if (status === "upcoming") {
    return "Wydarzenie pojawi się w katalogu przed startem. Zgłoszenia otworzą się, gdy operator uruchomi publiczną kolejkę.";
  }

  return requestsEnabled
    ? "Możesz przejść do formularza karaoke i dodać swoje zgłoszenie."
    : "Wydarzenie trwa, ale publiczne zgłoszenia są teraz zamknięte.";
}
