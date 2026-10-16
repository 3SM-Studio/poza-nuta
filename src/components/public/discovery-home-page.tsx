
import { getUiText } from "@/i18n/server";
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
  const tx = await getUiText();

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
          <h1>{tx("Znajdź karaoke blisko siebie")}</h1>
          <p>
            {tx("Odkrywaj wydarzenia karaoke w całej Polsce, sprawdzaj lokale i organizatorów oraz znajduj karaoke na dziś i najbliższe dni.")}</p>
          <EventSearchForm />
        </section>

        <div className={styles.sections}>
          <EventCarousel
            events={nowEvents}
            title={tx("Trwa teraz")}
            description={tx("Wydarzenia, które są aktualnie live.")}
          />
          <EventCarousel
            events={upcomingEvents}
            title={tx("Nadchodzące karaoke")}
            description={tx("Najbliższe publiczne wydarzenia karaoke.")}
          />
          <EventCarousel
            events={weekendEvents}
            title={tx("Ten weekend")}
            description={tx("Karaoke zaplanowane na najbliższy weekend.")}
          />
          <EventCarousel
            events={promotableNewestEvents}
            title={tx("Nowo dodane")}
            description={tx("Ostatnio opublikowane wydarzenia.")}
          />
        </div>

        {soonestEvents.length === 0 ? (
          <section className={styles.emptyState}>
            <h2>{tx("Brak publicznych wydarzeń")}</h2>
            <p>
              {tx("Katalog czeka na pierwsze opublikowane wydarzenia karaoke.")}</p>
            <Link className={styles.secondaryButton} href="/events">
              {tx("Przejdź do katalogu")}</Link>
          </section>
        ) : null}
      </div>
    </main>
  );
}
