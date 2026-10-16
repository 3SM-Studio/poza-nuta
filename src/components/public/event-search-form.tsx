
import { useUiText } from "@/i18n/use-ui-text";
import styles from "./discovery.module.css";

type EventSearchFormProps = {
  defaultValues?: {
    q?: string | null;
    city?: string | null;
    date?: string | null;
    phase?: string | null;
    sort?: string | null;
  };
  showDirectoryFilters?: boolean;
};

export function EventSearchForm({
  defaultValues,
  showDirectoryFilters = false,
}: EventSearchFormProps) {
  const tx = useUiText();

  return (
    <form className={styles.searchForm} action="/events" method="get">
      <div className={styles.searchField}>
        <label htmlFor="event-search-q">{tx("Czego szukasz?")}</label>
        <input
          id="event-search-q"
          name="q"
          type="search"
          defaultValue={defaultValues?.q ?? ""}
          placeholder={tx("Karaoke, lokal, nazwa wydarzenia")}
        />
      </div>
      <div className={styles.searchField}>
        <label htmlFor="event-search-city">{tx("Miasto")}</label>
        <input
          id="event-search-city"
          name="city"
          type="text"
          defaultValue={defaultValues?.city ?? ""}
          placeholder={tx("np. Warszawa")}
        />
      </div>
      <div className={styles.searchField}>
        <label htmlFor="event-search-date">{tx("Data")}</label>
        <input
          id="event-search-date"
          name="date"
          type="date"
          defaultValue={defaultValues?.date ?? ""}
        />
      </div>

      {showDirectoryFilters ? (
        <>
          <div className={styles.searchField}>
            <label htmlFor="event-search-phase">{tx("Status")}</label>
            <select
              id="event-search-phase"
              name="phase"
              defaultValue={defaultValues?.phase ?? "all"}
            >
              <option value="all">{tx("Wszystkie")}</option>
              <option value="live">{tx("Trwa teraz")}</option>
              <option value="upcoming">{tx("Nadchodzące")}</option>
              <option value="ended">{tx("Zakończone")}</option>
            </select>
          </div>
          <div className={styles.searchField}>
            <label htmlFor="event-search-sort">{tx("Sortowanie")}</label>
            <select
              id="event-search-sort"
              name="sort"
              defaultValue={defaultValues?.sort ?? "soonest"}
            >
              <option value="soonest">{tx("Najbliższe")}</option>
              <option value="newest">{tx("Nowo dodane")}</option>
            </select>
          </div>
        </>
      ) : null}

      <button className={styles.primaryButton} type="submit">
        {tx("Szukaj")}</button>
    </form>
  );
}
