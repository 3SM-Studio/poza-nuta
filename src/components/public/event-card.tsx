import Link from "next/link";

import type { PublicEventContract } from "@/lib/public-event-contract";
import { formatWarsawDateTime } from "@/lib/warsaw-time";

import styles from "./discovery.module.css";

export function PublicEventCard({ event }: { event: PublicEventContract }) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.statusPill}>{formatStatus(event.publicStatus)}</span>
        <h3>{event.name}</h3>
      </div>

      <dl className={styles.eventMeta}>
        <div>
          <dt>Termin</dt>
          <dd>{formatWarsawDateTime(event.startsAt)}</dd>
        </div>
        <div>
          <dt>Miasto</dt>
          <dd>{event.city || "Nie podano"}</dd>
        </div>
        <div>
          <dt>Lokal</dt>
          <dd>{event.venueName || "Nie podano"}</dd>
        </div>
      </dl>

      <Link className={styles.cardLink} href={`/events/${event.slug}`}>
        Szczegóły wydarzenia
      </Link>
    </article>
  );
}

function formatStatus(status: PublicEventContract["publicStatus"]) {
  switch (status) {
    case "cancelled":
      return "Odwołane";
    case "ended":
      return "Zakończone";
    case "live":
      return "Trwa teraz";
    default:
      return "Nadchodzące";
  }
}
