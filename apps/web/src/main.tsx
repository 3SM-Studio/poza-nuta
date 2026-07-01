import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createApiClient, isSameSearchResult, type ApiClient, type OperatorQueueDto, type PublicQueueDto, type SearchResultDto, type SongRequestDto, validateSubmitRequest } from "./lib/apiClient";
import "./styles.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4321";

function App() {
  const route = parseRoute(window.location.pathname);
  const api = useMemo(() => createApiClient(apiBaseUrl), []);

  if (!route) {
    return (
      <Shell title="Poza Nutą Karaoke">
        <EmptyState title="Nieznany widok" text="Użyj /event/test-event, /event/test-event/public albo /event/test-event/operator." />
      </Shell>
    );
  }

  if (route.view === "public") {
    return <PublicQueueView api={api} eventId={route.eventId} />;
  }

  if (route.view === "operator") {
    return <OperatorView api={api} eventId={route.eventId} />;
  }

  return <ParticipantView api={api} eventId={route.eventId} />;
}

function ParticipantView({ api, eventId }: { api: ApiClient; eventId: string }) {
  const [singerName, setSingerName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultDto[]>([]);
  const [selectedSong, setSelectedSong] = useState<SearchResultDto | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (nextQuery: string) => {
    const trimmedQuery = nextQuery.trim();
    if (!trimmedQuery) {
      setError("Wpisz szukana piosenke.");
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setLoading(true);
    setError("");
    setSuccess("");
    setSelectedSong(null);
    try {
      const response = await api.searchSongs(trimmedQuery, 10, controller.signal);
      setResults(response.results);
    } catch (searchError) {
      if (isAbortError(searchError)) {
        return;
      }
      setError(errorMessage(searchError));
      setResults([]);
    } finally {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      searchAbortRef.current?.abort();
      setResults([]);
      setSelectedSong(null);
      setLoading(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      void runSearch(trimmedQuery);
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [query, runSearch]);

  function search() {
    void runSearch(query);
  }

  async function submit() {
    const validationError = validateSubmitRequest({ singerName, song: selectedSong });
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError("");
    try {
      await api.submitRequest(eventId, { singerName, song: selectedSong as SearchResultDto });
      setSuccess("Zgłoszenie wysłane. Poczekaj na zatwierdzenie prowadzącego.");
      setQuery("");
      setResults([]);
      setSelectedSong(null);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell title="Zgłoś piosenkę" eventId={eventId}>
      <section className="panel request-panel">
        <label>
          Imię
          <input value={singerName} onChange={(event) => setSingerName(event.target.value)} placeholder="Michał" />
        </label>
        <label>
          Szukaj piosenki
          <div className="inline-form">
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && search()} placeholder="krolowa lez" />
            <button onClick={search} disabled={loading}>Szukaj</button>
          </div>
        </label>
        <Message error={error} success={success} />
      </section>

      <section className="list-section">
        {results.length === 0 ? (
          <EmptyState title="Brak wyników" text="Wyszukaj piosenkę po tytule lub artyście." />
        ) : (
          results.map((song) => (
            <button key={`${song.source}:${song.sourceSongId}`} className={`song-row ${isSameSearchResult(selectedSong, song) ? "selected" : ""}`} onClick={() => setSelectedSong(song)}>
              <span>
                <strong>{song.artist} - {song.title}</strong>
                <small>Score {song.score} · {formatSource(song.source)}</small>
              </span>
              <span>{isSameSearchResult(selectedSong, song) ? "Wybrano" : "Wybierz"}</span>
            </button>
          ))
        )}
      </section>

      <div className="sticky-action">
        <button onClick={submit} disabled={loading || !singerName.trim() || !selectedSong}>Wyślij zgłoszenie</button>
      </div>
    </Shell>
  );
}

function PublicQueueView({ api, eventId }: { api: ApiClient; eventId: string }) {
  const [queue, setQueue] = useState<PublicQueueDto | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setQueue(await api.getPublicQueue(eventId));
      setError("");
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    }
  }, [api, eventId]);

  usePolling(refresh, 3000);

  return (
    <Shell title="Kolejka publiczna" eventId={eventId}>
      <Message error={error} />
      <div className="queue-grid">
        <QueueCard title="Now" item={queue?.now} empty="Nikt teraz nie śpiewa." />
        <QueueCard title="Next" item={queue?.next} empty="Brak następnej osoby." />
      </div>
      <section className="panel">
        <h2>Upcoming</h2>
        {queue?.upcoming.length ? queue.upcoming.map((item) => <PublicQueueRow key={`${item.position}:${item.displayName}`} item={item} />) : <p className="muted">Kolejka jest pusta.</p>}
      </section>
    </Shell>
  );
}

function OperatorView({ api, eventId }: { api: ApiClient; eventId: string }) {
  const [queue, setQueue] = useState<OperatorQueueDto | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setQueue(await api.getOperatorQueue(eventId));
      setError("");
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    }
  }, [api, eventId]);

  usePolling(refresh, 2000);

  async function action(operation: () => Promise<{ operatorQueue: OperatorQueueDto }>) {
    try {
      const response = await operation();
      setQueue(response.operatorQueue);
      setError("");
    } catch (actionError) {
      setError(errorMessage(actionError));
    }
  }

  return (
    <Shell title="Panel prowadzącego" eventId={eventId}>
      <Message error={error} />
      <OperatorGroup title="Now" requests={queue?.now ?? []} actions={(request) => <button onClick={() => action(() => api.done(eventId))}>Done</button>} />
      <OperatorGroup title="Pending" requests={queue?.pending ?? []} actions={(request) => (
        <>
          <button onClick={() => action(() => api.approve(eventId, request.id))}>Approve</button>
          <button className="secondary danger" onClick={() => action(() => api.reject(eventId, request.id))}>Reject</button>
        </>
      )} />
      <OperatorGroup title="Approved" requests={queue?.approved ?? []} actions={(request) => (
        <>
          <button onClick={() => action(() => api.start(eventId, request.id))}>Start</button>
          <button className="secondary" onClick={() => action(() => api.skip(eventId, request.id))}>Skip</button>
        </>
      )} />
      <div className="history-grid">
        <OperatorGroup title="Done" requests={queue?.done ?? []} compact />
        <OperatorGroup title="Skipped" requests={queue?.skipped ?? []} compact />
        <OperatorGroup title="Rejected" requests={queue?.rejected ?? []} compact />
      </div>
    </Shell>
  );
}

function Shell({ title, eventId, children }: { title: string; eventId?: string; children: React.ReactNode }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>{title}</h1>
          {eventId ? <p>Event: {eventId}</p> : null}
        </div>
        {eventId ? (
          <nav>
            <a href={`/event/${eventId}`}>Request</a>
            <a href={`/event/${eventId}/public`}>Public</a>
            <a href={`/event/${eventId}/operator`}>Operator</a>
          </nav>
        ) : null}
      </header>
      {children}
    </main>
  );
}

function QueueCard({ title, item, empty }: { title: string; item?: PublicQueueDto["now"]; empty: string }) {
  return (
    <section className="panel queue-card">
      <h2>{title}</h2>
      {item ? <PublicQueueRow item={item} large /> : <p className="muted">{empty}</p>}
    </section>
  );
}

function PublicQueueRow({ item, large = false }: { item: PublicQueueDto["now"]; large?: boolean }) {
  if (!item) {
    return null;
  }

  return (
    <div className={`queue-row ${large ? "large" : ""}`}>
      <span className="position">{item.position ?? "-"}</span>
      <span>
        <strong>{item.displayName}</strong>
        {item.songTitle && item.songArtist ? <small>{item.songArtist} - {item.songTitle}</small> : null}
      </span>
    </div>
  );
}

function OperatorGroup({ title, requests, actions, compact = false }: { title: string; requests: SongRequestDto[]; actions?: (request: SongRequestDto) => React.ReactNode; compact?: boolean }) {
  return (
    <section className={`panel ${compact ? "compact" : ""}`}>
      <h2>{title}</h2>
      {requests.length === 0 ? <p className="muted">Brak.</p> : requests.map((request) => (
        <div className="operator-row" key={request.id}>
          <div>
            <strong>{request.displayName ?? request.singerName}</strong>
            <small>{request.songArtist} - {request.songTitle}</small>
            <small>{request.status} · {request.position ?? "-"}</small>
          </div>
          {actions ? <div className="row-actions">{actions(request)}</div> : null}
        </div>
      ))}
    </section>
  );
}

function Message({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) {
    return null;
  }
  return <p className={error ? "message error" : "message success"}>{error || success}</p>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <section className="panel empty-state">
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function usePolling(callback: () => Promise<void>, intervalMs: number) {
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) {
        await callback();
      }
    };
    void tick();
    const interval = window.setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [callback, intervalMs]);
}

function parseRoute(pathname: string): { eventId: string; view: "participant" | "public" | "operator" } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "event" || !parts[1]) {
    return null;
  }

  if (parts[2] === "public") {
    return { eventId: parts[1], view: "public" };
  }

  if (parts[2] === "operator") {
    return { eventId: parts[1], view: "operator" };
  }

  return { eventId: parts[1], view: "participant" };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Wystąpił błąd.";
}

function formatSource(source: string): string {
  return source === "ising" ? "iSing" : source;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
