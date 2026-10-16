
import { getUiText } from "@/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import styles from "@/components/public/public.module.css";
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
  const tx = await getUiText();

  const { slug } = await params;
  const event = await loadPublicEvent(slug);

  return (
    <main className={styles.publicPage}>
      <div className={styles.eventShell}>
        <header className={styles.eventHeader}>
          <p className={styles.statusPill}>{tx(formatPublicStatus(event.publicStatus))}</p>
          <h1>{event.name}</h1>
        </header>

        <section className={styles.eventSummary} aria-label={tx("Szczegóły wydarzenia")}>
          <dl className={styles.eventDetails}>
            <div>
              <dt>{tx("Start")}</dt>
              <dd>{tx.date(event.startsAt)}</dd>
            </div>
            <div>
              <dt>{tx("Koniec")}</dt>
              <dd>{event.endsAt ? tx.date(event.endsAt) : tx("Do zamknięcia")}</dd>
            </div>
            <div>
              <dt>{tx("Miejsce")}</dt>
              <dd>{event.venueName ?? tx("Nie podano")}</dd>
            </div>
            <div>
              <dt>{tx("Miasto")}</dt>
              <dd>{event.city ?? tx("Nie podano")}</dd>
            </div>
            <div>
              <dt>{tx("Zgłoszenia")}</dt>
              <dd>{event.requestsEnabled ? tx("Otwarte") : tx("Zamknięte")}</dd>
            </div>
            <div>
              <dt>{tx("Kolejka publiczna")}</dt>
              <dd>{event.publicQueueEnabled ? tx("Włączona") : tx("Wyłączona")}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.publicSection}>
          <h2>{tx(getStateHeading(event.publicStatus))}</h2>
          <p className={styles.inlineMessage}>
            {tx(getStateDescription(event.publicStatus, event.requestsEnabled))}
          </p>
          <div className={styles.eventActions}>
            {event.facebookUrl ? (
              <a
                className={styles.secondaryButton}
                href={event.facebookUrl}
                rel="noreferrer"
                target="_blank"
              >
                {tx("Facebook")}</a>
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


function formatPublicStatus(status: string) {
  switch (status) {
    case "cancelled":
      return "Odwolane";
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
    case "cancelled":
      return "Wydarzenie odwolane";
    case "live":
      return "Wydarzenie trwa";
    case "ended":
      return "Wydarzenie zakończone";
    default:
      return "Wydarzenie nadchodzi";
  }
}

function getStateDescription(status: string, requestsEnabled: boolean) {
  if (status === "cancelled") {
    return "To wydarzenie zostalo odwolane, wiec publiczne zgloszenia sa zamkniete.";
  }

  if (status === "ended") {
    return "To wydarzenie jest już zakończone, więc publiczne zgłoszenia są zamknięte.";
  }

  if (status === "upcoming") {
    return "Wydarzenie pojawi się w katalogu przed startem. Zgłoszenia otworzą się, gdy wydarzenie będzie trwało.";
  }

  return requestsEnabled
    ? "Zgłoszenia piosenek są dostępne podczas wydarzenia przez kod QR udostępniony przez organizatora."
    : "Wydarzenie trwa, ale publiczne zgłoszenia są teraz zamknięte.";
}
