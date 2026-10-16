
import { getUiText } from "@/i18n/server";
import type { Metadata } from "next";

import styles from "@/components/public/discovery.module.css";
import { PublicEventCard } from "@/components/public/event-card";
import { EventSearchForm } from "@/components/public/event-search-form";
import { listPublicEvents } from "@/server/public-api/service";

export async function generateMetadata(): Promise<Metadata> {
  const tx = await getUiText();
  return {
  title: tx("Katalog karaoke | Poza Nutą"),
  description: tx("Przeglądaj publiczne wydarzenia karaoke w Polsce."),
};
}

export const dynamic = "force-dynamic";

type EventsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const tx = await getUiText();

  const params = await searchParams;
  const query = getFirstParam(params.q);
  const city = getFirstParam(params.city);
  const date = getFirstParam(params.date);
  const phase = getFirstParam(params.phase) ?? "all";
  const sort = getFirstParam(params.sort) ?? "soonest";
  let events: Awaited<ReturnType<typeof listPublicEvents>> = [];
  let loadFailed = false;

  try {
    events = await listPublicEvents("public.events.page", {
      q: query,
      city,
      date,
      phase,
      sort,
    });
  } catch {
    loadFailed = true;
  }

  if (loadFailed) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <section className={styles.errorState}>
            <h1>{tx("Nie udało się wczytać katalogu")}</h1>
            <p>{tx("Odśwież stronę albo spróbuj ponownie za chwilę.")}</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <h1>{tx("Katalog wydarzeń karaoke")}</h1>
          <p>
            {tx("Przeglądaj publiczne karaoke w Polsce i zawężaj wyniki po mieście, dacie, statusie oraz sortowaniu.")}</p>
          <EventSearchForm
            showDirectoryFilters
            defaultValues={{ q: query, city, date, phase, sort }}
          />
        </section>

        {events.length > 0 ? (
          <section aria-label={tx("Wyniki katalogu")}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>{tx("Wyniki")}</h2>
                <p>{events.length} {tx(" wydarzeń w katalogu")}</p>
              </div>
            </div>
            <div className={styles.grid}>
              {events.map((event) => (
                <PublicEventCard event={event} key={event.id} />
              ))}
            </div>
          </section>
        ) : (
          <section className={styles.emptyState}>
            <h2>{tx("Brak pasujących wydarzeń")}</h2>
            <p>{tx("Zmień filtry lub sprawdź katalog ponownie później.")}</p>
          </section>
        )}
      </div>
    </main>
  );
}

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
