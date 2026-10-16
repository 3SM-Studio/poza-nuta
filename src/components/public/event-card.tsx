
import { useUiText } from "@/i18n/use-ui-text";
import Link from "next/link";

import type { PublicEventContract } from "@/lib/public-event-contract";

import styles from "./discovery.module.css";

export function PublicEventCard({ event }: { event: PublicEventContract }) {
  const tx = useUiText();

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.statusPill}>{tx(formatStatus(event.publicStatus))}</span>
        <h3>{event.name}</h3>
      </div>

      <dl className={styles.eventMeta}>
        <div>
          <dt>{tx("Termin")}</dt>
          <dd>{tx.date(event.startsAt)}</dd>
        </div>
        <div>
          <dt>{tx("Miasto")}</dt>
          <dd>{event.city || tx("Nie podano")}</dd>
        </div>
        <div>
          <dt>{tx("Lokal")}</dt>
          <dd>{event.venueName || tx("Nie podano")}</dd>
        </div>
      </dl>

      <Link className={styles.cardLink} href={`/events/${event.slug}`}>
        {tx("Szczegóły wydarzenia")}</Link>
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
