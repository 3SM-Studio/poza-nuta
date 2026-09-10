import Link from "next/link";

import {
  isInWarsawWeekend,
  isPromotablePublicEventStatus,
} from "@/lib/public-event-discovery";
import { listPublicEvents } from "@/server/public-api/service";

import styles from "./discovery.module.css";
import { EventCarousel } from "./event-carousel";
import { EventSearchForm } from "./event-search-form";

export async function DiscoveryHomePage() {
  const [soonestEvents, newestEvents] = await Promise.all([
    listPublicEvents("public.home.soonest", { phase: "all", sort: "soonest" }),
    listPublicEvents("public.home.newest", { phase: "all", sort: "newest" }),
  ]);
  const nowEvents = soonestEvents.filter((event) => event.publicStatus === "live");
  const upcomingEvents = soonestEvents.filter(
    (event) => event.publicStatus === "upcoming",
  );
  const weekendEvents = soonestEvents.filter(
    (event) =>
      isPromotablePublicEventStatus(event.publicStatus) &&
      isInWarsawWeekend(event.startsAt),
  );
  const promotableNewestEvents = newestEvents.filter((event) =>
    isPromotablePublicEventStatus(event.publicStatus),
  );

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <h1>Znajdź karaoke blisko siebie</h1>
          <p>
            Odkrywaj wydarzenia karaoke w całej Polsce, sprawdzaj lokale i
            organizatorów oraz znajduj karaoke na dziś i najbliższe dni.
          </p>
          <EventSearchForm />
        </section>

        <div className={styles.sections}>
          <EventCarousel
            events={nowEvents}
            title="Trwa teraz"
            description="Wydarzenia, które są aktualnie live."
          />
          <EventCarousel
            events={upcomingEvents}
            title="Nadchodzące karaoke"
            description="Najbliższe publiczne wydarzenia karaoke."
          />
          <EventCarousel
            events={weekendEvents}
            title="Ten weekend"
            description="Karaoke zaplanowane na najbliższy weekend."
          />
          <EventCarousel
            events={promotableNewestEvents}
            title="Nowo dodane"
            description="Ostatnio opublikowane wydarzenia."
          />
        </div>

        {soonestEvents.length === 0 ? (
          <section className={styles.emptyState}>
            <h2>Brak publicznych wydarzeń</h2>
            <p>
              Katalog czeka na pierwsze opublikowane wydarzenia karaoke.
            </p>
            <Link className={styles.secondaryButton} href="/events">
              Przejdź do katalogu
            </Link>
          </section>
        ) : null}
      </div>
    </main>
  );
}
