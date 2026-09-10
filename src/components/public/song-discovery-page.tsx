"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { SessionStateAlert, type SessionStateAlertKind } from "@/components/public/session-state-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  PublicSongBrowseItem,
  SessionSongDiscovery,
} from "./api";
import {
  browseSessionSongs,
  createSessionRequest,
  SessionClientError,
} from "./session-api";
import discoveryStyles from "./song-discovery.module.css";

const BROWSE_PAGE_SIZE = 24;

type BrowseState = {
  q: string | null;
  genre: string | null;
  language: string | null;
  duet: boolean;
  hit: boolean;
  sort: "title" | "artist" | "newest";
};

type DiscoveryLink = {
  label: string;
  state: Partial<BrowseState>;
};

export function SongDiscoveryTeaser({
  sessionToken,
  discovery,
}: {
  sessionToken: string;
  discovery: SessionSongDiscovery;
}) {
  const discoveryLinks = getDiscoveryLinks(discovery);

  return (
    <aside className={discoveryStyles.teaser} aria-labelledby="song-discovery-heading">
      <div>
        <p className={discoveryStyles.eyebrow}>Odkrywaj</p>
        <h3 id="song-discovery-heading">Znajdź coś dla siebie</h3>
        <p>
          Przeglądaj katalog po kategoriach albo zawęź wyniki bez znajomości
          konkretnego tytułu.
        </p>
      </div>
      {discoveryLinks.length > 0 ? (
        <div className={discoveryStyles.chipList} aria-label="Kategorie odkrywania">
          {discoveryLinks.map((link) => (
            <Link
              className={discoveryStyles.chip}
              href={buildSongsHref(sessionToken, { ...emptyBrowseState, ...link.state })}
              key={link.label}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
      <Link
        className={discoveryStyles.browseLink}
        href={buildSongsHref(sessionToken, emptyBrowseState)}
      >
        Przeglądaj wszystkie piosenki
      </Link>
    </aside>
  );
}

export function SongDiscoveryPage({
  sessionToken,
  discovery,
}: {
  sessionToken: string;
  discovery: SessionSongDiscovery;
}) {
  const searchParams = useSearchParams();
  const urlState = useMemo(
    () => readBrowseState(searchParams),
    [searchParams],
  );

  return (
    <SongDiscoveryCatalog
      key={buildSongsHref(sessionToken, urlState)}
      browseState={urlState}
      discovery={discovery}
      sessionToken={sessionToken}
    />
  );
}

function SongDiscoveryCatalog({
  sessionToken,
  discovery,
  browseState,
}: {
  sessionToken: string;
  discovery: SessionSongDiscovery;
  browseState: BrowseState;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [searchValue, setSearchValue] = useState(browseState.q ?? "");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [items, setItems] = useState<PublicSongBrowseItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [submittingSongId, setSubmittingSongId] = useState<number | null>(null);
  const [submitAlert, setSubmitAlert] =
    useState<SessionStateAlertKind | null>(null);
  const requestVersion = useRef(0);
  const loadMoreController = useRef<AbortController | null>(null);

  const abortLoadMore = useCallback(() => {
    loadMoreController.current?.abort();
    loadMoreController.current = null;
  }, []);

  useEffect(
    () => () => {
      abortLoadMore();
    },
    [abortLoadMore],
  );

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;

    void browseSessionSongs(
      sessionToken,
      { ...browseState, limit: BROWSE_PAGE_SIZE },
      controller.signal,
    )
      .then((response) => {
        if (version !== requestVersion.current) return;
        setItems(response.items);
        setNextCursor(response.nextCursor);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || version !== requestVersion.current) return;
        setItems([]);
        setNextCursor(null);
        setLoadError(getBrowseErrorMessage(error));
      })
      .finally(() => {
        if (version === requestVersion.current) setIsLoading(false);
      });

    return () => controller.abort();
  }, [browseState, reloadKey, sessionToken]);

  const updateBrowseState = useCallback(
    (patch: Partial<BrowseState>) => {
      const nextState = { ...browseState, ...patch };
      if (areBrowseStatesEqual(browseState, nextState)) return;

      abortLoadMore();
      requestVersion.current += 1;
      setIsLoading(true);
      setIsLoadingMore(false);
      setLoadError(null);
      setNextCursor(null);
      setSubmitAlert(null);
      router.replace(buildSongsHref(sessionToken, nextState, pathname), {
        scroll: false,
      });
    },
    [abortLoadMore, browseState, pathname, router, sessionToken],
  );

  function retryBrowse() {
    abortLoadMore();
    requestVersion.current += 1;
    setIsLoading(true);
    setIsLoadingMore(false);
    setLoadError(null);
    setNextCursor(null);
    setReloadKey((value) => value + 1);
  }

  async function loadMore() {
    if (!nextCursor || isLoadingMore || loadMoreController.current) return;

    const controller = new AbortController();
    loadMoreController.current = controller;
    const version = ++requestVersion.current;
    setIsLoadingMore(true);
    setLoadError(null);

    try {
      const response = await browseSessionSongs(
        sessionToken,
        { ...browseState, cursor: nextCursor, limit: BROWSE_PAGE_SIZE },
        controller.signal,
      );
      if (controller.signal.aborted || version !== requestVersion.current) return;
      setItems((current) => [...current, ...response.items]);
      setNextCursor(response.nextCursor);
    } catch (error) {
      if (controller.signal.aborted || version !== requestVersion.current) return;
      setLoadError(getBrowseErrorMessage(error));
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
      }
      if (!controller.signal.aborted && version === requestVersion.current) {
        setIsLoadingMore(false);
      }
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = searchValue.trim().replace(/\s+/g, " ");

    if (value.length === 1) {
      setSearchError("Wpisz co najmniej 2 znaki albo wyczyść wyszukiwanie.");
      return;
    }

    setSearchError(null);
    updateBrowseState({ q: value || null });
  }

  function clearFilters() {
    setSearchValue("");
    setSearchError(null);
    updateBrowseState(emptyBrowseState);
  }

  async function submitSong(song: PublicSongBrowseItem) {
    if (submittingSongId !== null) return;

    setSubmittingSongId(song.id);
    setSubmitAlert(null);
    try {
      await createSessionRequest(sessionToken, { songId: song.id });
      toast.success("Dodano zgłoszenie", {
        description: "Operator musi je zatwierdzić.",
      });
    } catch (error) {
      const alertKind = getSubmitAlertKind(error);
      if (alertKind) {
        setSubmitAlert(alertKind);
      } else {
        toast.error("Nie udało się dodać zgłoszenia", {
          description: getSubmitErrorMessage(error),
        });
      }
    } finally {
      setSubmittingSongId(null);
    }
  }

  const activeFilterLabels = getActiveFilterLabels(browseState, discovery);
  const showFilterSummary = activeFilterLabels.length > 0 || Boolean(browseState.q);

  return (
    <section className={discoveryStyles.catalog} aria-labelledby="song-catalog-heading">
      <div className={discoveryStyles.catalogHeading}>
        <div>
          <p className={discoveryStyles.eyebrow}>Katalog piosenek</p>
          <h2 id="song-catalog-heading">Znajdź piosenkę</h2>
          <p>Przeglądaj katalog lub zawęź go do tego, na co masz ochotę.</p>
        </div>
        <Link className={discoveryStyles.backLink} href={`/s/${encodeURIComponent(sessionToken)}`}>
          Wróć do wydarzenia
        </Link>
      </div>

      <form className={discoveryStyles.searchForm} onSubmit={handleSearch}>
        <label className={discoveryStyles.searchField} htmlFor="catalog-song-search">
          <span>Szukaj piosenki lub wykonawcy</span>
          <Input
            id="catalog-song-search"
            type="search"
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value);
              setSearchError(null);
            }}
            placeholder="Np. rock, Queen albo Maanam"
            aria-invalid={Boolean(searchError)}
            aria-describedby={searchError ? "catalog-search-error" : undefined}
          />
        </label>
        <Button type="submit">Szukaj</Button>
      </form>
      {searchError ? (
        <p className={discoveryStyles.fieldError} id="catalog-search-error" role="alert">
          {searchError}
        </p>
      ) : null}

      <fieldset className={discoveryStyles.filters}>
        <legend>Filtry katalogu</legend>
        <label className={discoveryStyles.selectField} htmlFor="catalog-genre">
          <span>Gatunek</span>
          <select
            id="catalog-genre"
            value={browseState.genre ?? ""}
            onChange={(event) =>
              updateBrowseState({ genre: event.target.value || null })
            }
          >
            <option value="">Wszystkie gatunki</option>
            {discovery.genres.map((genre) => (
              <option key={genre.value} value={genre.value}>
                {genre.label} ({genre.count})
              </option>
            ))}
          </select>
        </label>
        <label className={discoveryStyles.selectField} htmlFor="catalog-language">
          <span>Język</span>
          <select
            id="catalog-language"
            value={browseState.language ?? ""}
            onChange={(event) =>
              updateBrowseState({ language: event.target.value || null })
            }
          >
            <option value="">Wszystkie języki</option>
            {discovery.languages.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label} ({language.count})
              </option>
            ))}
          </select>
        </label>
        <div className={discoveryStyles.toggleGroup} aria-label="Cechy piosenki">
          {discovery.features.duetCount > 0 ? (
            <Button
              type="button"
              variant={browseState.duet ? "default" : "outline"}
              aria-pressed={browseState.duet}
              onClick={() => updateBrowseState({ duet: !browseState.duet })}
            >
              Tylko duety
            </Button>
          ) : null}
          {discovery.features.hitCount > 0 ? (
            <Button
              type="button"
              variant={browseState.hit ? "default" : "outline"}
              aria-pressed={browseState.hit}
              onClick={() => updateBrowseState({ hit: !browseState.hit })}
            >
              Tylko hity
            </Button>
          ) : null}
        </div>
        <label className={discoveryStyles.selectField} htmlFor="catalog-sort">
          <span>Sortowanie</span>
          <select
            id="catalog-sort"
            value={browseState.sort}
            onChange={(event) =>
              updateBrowseState({ sort: parseBrowseSort(event.target.value) })
            }
          >
            <option value="title">Tytuł A–Z</option>
            <option value="artist">Wykonawca A–Z</option>
            <option value="newest">Ostatnio dodane</option>
          </select>
        </label>
      </fieldset>

      {showFilterSummary ? (
        <div className={discoveryStyles.filterSummary} aria-label="Aktywne filtry">
          <span>{formatFilterSummary(browseState, activeFilterLabels)}</span>
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Wyczyść filtry
          </Button>
        </div>
      ) : null}

      <p className={discoveryStyles.resultStatus} aria-live="polite" role="status">
        {isLoading
          ? "Wczytywanie piosenek…"
          : `Wyświetlono ${items.length} ${formatSongCount(items.length)}.`}
      </p>

      {loadError ? (
        <div className={discoveryStyles.errorState} role="alert">
          <p>{loadError}</p>
          <Button type="button" variant="outline" onClick={retryBrowse}>
            Spróbuj ponownie
          </Button>
        </div>
      ) : null}

      {!isLoading && !loadError && items.length === 0 ? (
        <div className={discoveryStyles.emptyState}>
          <h3>Brak pasujących piosenek</h3>
          <p>Zmień filtry albo spróbuj innego tytułu lub wykonawcy.</p>
          <Button type="button" variant="outline" onClick={clearFilters}>
            Wyczyść filtry
          </Button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className={discoveryStyles.songList} aria-label="Wyniki katalogu">
          {items.map((song) => (
            <article className={discoveryStyles.songCard} data-song-id={song.id} key={song.id}>
              <div className={discoveryStyles.songCopy}>
                <h3>{song.title}</h3>
                <p>{song.artist}</p>
                <div className={discoveryStyles.badges} aria-label="Cechy piosenki">
                  {song.isDuet ? <span>Duet</span> : null}
                  {song.isHit ? <span>Hit</span> : null}
                  {song.isPlus ? <span>Plus</span> : null}
                  {song.isExplicit ? <span>Explicit</span> : null}
                  {song.genres[0] ? <span>{song.genres[0]}</span> : null}
                  {song.languages[0] ? <span>{song.languages[0]}</span> : null}
                </div>
              </div>
              <Button
                type="button"
                onClick={() => void submitSong(song)}
                disabled={submittingSongId !== null}
              >
                {submittingSongId === song.id ? "Dodaję…" : "Zgłoś"}
              </Button>
            </article>
          ))}
        </div>
      ) : null}

      {submitAlert ? <SessionStateAlert kind={submitAlert} /> : null}

      {!isLoading && !loadError && nextCursor ? (
        <Button
          className={discoveryStyles.loadMoreButton}
          type="button"
          variant="outline"
          onClick={() => void loadMore()}
          disabled={isLoadingMore}
        >
          {isLoadingMore ? "Wczytuję…" : "Pokaż więcej"}
        </Button>
      ) : null}
      {!isLoading && !loadError && items.length > 0 && !nextCursor ? (
        <p className={discoveryStyles.endMessage}>To już wszystkie pasujące piosenki.</p>
      ) : null}
    </section>
  );
}

const emptyBrowseState: BrowseState = {
  q: null,
  genre: null,
  language: null,
  duet: false,
  hit: false,
  sort: "title",
};

function readBrowseState(
  searchParams: Pick<URLSearchParams, "get">,
): BrowseState {
  const q = searchParams.get("q")?.trim() ?? "";
  const sort = searchParams.get("sort");

  return {
    q: q.length >= 2 ? q : null,
    genre: searchParams.get("genre")?.trim().toLocaleLowerCase("en-US") || null,
    language:
      searchParams.get("language")?.trim().toLocaleLowerCase("en-US") || null,
    duet: searchParams.get("duet") === "true",
    hit: searchParams.get("hit") === "true",
    sort: sort === "artist" || sort === "newest" ? sort : "title",
  };
}

function parseBrowseSort(value: string): BrowseState["sort"] {
  if (value === "artist" || value === "newest") return value;
  return "title";
}

function buildSongsHref(
  sessionToken: string,
  state: BrowseState,
  pathname = `/s/${encodeURIComponent(sessionToken)}/songs`,
) {
  const searchParams = new URLSearchParams();
  if (state.q) searchParams.set("q", state.q);
  if (state.genre) searchParams.set("genre", state.genre);
  if (state.language) searchParams.set("language", state.language);
  if (state.duet) searchParams.set("duet", "true");
  if (state.hit) searchParams.set("hit", "true");
  if (state.sort !== "title") searchParams.set("sort", state.sort);
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function getDiscoveryLinks(discovery: SessionSongDiscovery): DiscoveryLink[] {
  const links: DiscoveryLink[] = [];
  if (discovery.features.hitCount > 0) {
    links.push({ label: "Hity", state: { hit: true } });
  }
  if (discovery.features.duetCount > 0) {
    links.push({ label: "Duety", state: { duet: true } });
  }

  for (const genre of discovery.genres) {
    if (genre.value === "duet" || links.length >= 4) continue;
    links.push({ label: genre.label, state: { genre: genre.value } });
  }

  return links;
}

function getActiveFilterLabels(
  state: BrowseState,
  discovery: SessionSongDiscovery,
) {
  const labels: string[] = [];
  const genre = discovery.genres.find((item) => item.value === state.genre);
  const language = discovery.languages.find(
    (item) => item.value === state.language,
  );
  if (genre) labels.push(genre.label);
  if (language) labels.push(language.label);
  if (state.duet) labels.push("Duety");
  if (state.hit) labels.push("Hity");
  return labels;
}

function formatFilterSummary(state: BrowseState, labels: string[]) {
  const parts = [state.q ? `Szukasz: „${state.q}”` : null, ...labels].filter(
    (value): value is string => Boolean(value),
  );
  return `Aktywne: ${parts.join(" · ")}`;
}

function areBrowseStatesEqual(left: BrowseState, right: BrowseState) {
  return (
    left.q === right.q &&
    left.genre === right.genre &&
    left.language === right.language &&
    left.duet === right.duet &&
    left.hit === right.hit &&
    left.sort === right.sort
  );
}

function formatSongCount(count: number) {
  if (count === 1) return "piosenkę";
  if (count % 10 >= 2 && count % 10 <= 4 && (count < 10 || count > 20)) {
    return "piosenki";
  }
  return "piosenek";
}

function getBrowseErrorMessage(error: unknown) {
  if (error instanceof SessionClientError) {
    if (error.code === "SESSION_EVENT_NOT_STARTED") {
      return "Wydarzenie jeszcze się nie rozpoczęło.";
    }
    if (error.code === "SESSION_EVENT_CLOSED") {
      return "Sesja została zakończona.";
    }
    if (error.code === "SESSION_PUBLIC_REQUESTS_DISABLED") {
      return "Publiczne zgłoszenia piosenek są wyłączone.";
    }
  }
  return "Nie udało się wczytać katalogu. Spróbuj ponownie.";
}

function getSubmitAlertKind(error: unknown): SessionStateAlertKind | null {
  if (!(error instanceof SessionClientError)) return null;
  if (error.status === 429 || error.code === "SESSION_RATE_LIMITED") {
    return "rate_limited";
  }
  if (error.code === "SESSION_REQUEST_DUPLICATE") return "duplicate_request";
  if (error.code === "SESSION_EVENT_NOT_STARTED") return "scheduled";
  if (error.code === "SESSION_EVENT_CLOSED") return "closed";
  if (error.code === "SESSION_PUBLIC_REQUESTS_DISABLED") return "queue_disabled";
  return null;
}

function getSubmitErrorMessage(error: unknown) {
  if (error instanceof SessionClientError) {
    if (error.code === "SONG_NOT_FOUND") {
      return "Ta piosenka nie jest już dostępna. Odśwież katalog.";
    }
    if (error.code === "SESSION_PARTICIPANT_REQUIRED") {
      return "Dołącz ponownie do wydarzenia przed zgłoszeniem piosenki.";
    }
  }
  return "Spróbuj ponownie za chwilę.";
}
