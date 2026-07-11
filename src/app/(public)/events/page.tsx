import type { Metadata } from "next";

import styles from "@/components/public/discovery.module.css";
import { PublicEventCard } from "@/components/public/event-card";
import { EventSearchForm } from "@/components/public/event-search-form";
import { listPublicEvents } from "@/server/public-api/service";

export const metadata: Metadata = {
  title: "Katalog karaoke | Poza Nutą",
  description: "Przeglądaj publiczne wydarzenia karaoke w Polsce.",
};

export const dynamic = "force-dynamic";

type EventsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventsPage({ searchParams }: EventsPageProps) {
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
            <h1>Nie udało się wczytać katalogu</h1>
            <p>Odśwież stronę albo spróbuj ponownie za chwilę.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <h1>Katalog wydarzeń karaoke</h1>
          <p>
            Przeglądaj publiczne karaoke w Polsce i zawężaj wyniki po mieście,
            dacie, statusie oraz sortowaniu.
          </p>
          <EventSearchForm
            showDirectoryFilters
            defaultValues={{ q: query, city, date, phase, sort }}
          />
        </section>

        {events.length > 0 ? (
          <section aria-label="Wyniki katalogu">
            <div className={styles.sectionHeader}>
              <div>
                <h2>Wyniki</h2>
                <p>{events.length} wydarzeń w katalogu</p>
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
            <h2>Brak pasujących wydarzeń</h2>
            <p>Zmień filtry lub sprawdź katalog ponownie później.</p>
          </section>
        )}
      </div>
    </main>
  );
}

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
