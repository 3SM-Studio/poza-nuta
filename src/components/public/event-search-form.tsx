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
  return (
    <form className={styles.searchForm} action="/events" method="get">
      <div className={styles.searchField}>
        <label htmlFor="event-search-q">Czego szukasz?</label>
        <input
          id="event-search-q"
          name="q"
          type="search"
          defaultValue={defaultValues?.q ?? ""}
          placeholder="Karaoke, lokal, nazwa wydarzenia"
        />
      </div>
      <div className={styles.searchField}>
        <label htmlFor="event-search-city">Miasto</label>
        <input
          id="event-search-city"
          name="city"
          type="text"
          defaultValue={defaultValues?.city ?? ""}
          placeholder="np. Warszawa"
        />
      </div>
      <div className={styles.searchField}>
        <label htmlFor="event-search-date">Data</label>
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
            <label htmlFor="event-search-phase">Status</label>
            <select
              id="event-search-phase"
              name="phase"
              defaultValue={defaultValues?.phase ?? "all"}
            >
              <option value="all">Wszystkie</option>
              <option value="live">Trwa teraz</option>
              <option value="upcoming">Nadchodzące</option>
              <option value="ended">Zakończone</option>
            </select>
          </div>
          <div className={styles.searchField}>
            <label htmlFor="event-search-sort">Sortowanie</label>
            <select
              id="event-search-sort"
              name="sort"
              defaultValue={defaultValues?.sort ?? "soonest"}
            >
              <option value="soonest">Najbliższe</option>
              <option value="newest">Nowo dodane</option>
            </select>
          </div>
        </>
      ) : null}

      <button className={styles.primaryButton} type="submit">
        Szukaj
      </button>
    </form>
  );
}
