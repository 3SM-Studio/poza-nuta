"use client";

import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicSongBrowseItem, SessionSongBrowseInput } from "./api";
import { browseSessionSongs } from "./session-api";
import { SessionSongRow } from "./session-song-row";

const PAGE_SIZE = 24;

type CatalogSongListProps = {
  backLabel: string;
  heading: string;
  input: Omit<SessionSongBrowseInput, "cursor" | "limit">;
  onBack: () => void;
  onSongSelect: (song: PublicSongBrowseItem) => void;
  sessionToken: string;
  initialItems?: PublicSongBrowseItem[];
  initialNextCursor?: string | null;
  forceInitialLoading?: boolean;
  forceLoadMoreLoading?: boolean;
  initialLoadMoreError?: string | null;
};

type CatalogState = {
  items: PublicSongBrowseItem[];
  nextCursor: string | null;
  status: "loading" | "ready" | "error";
};

export function CatalogSongList({
  backLabel,
  heading,
  input,
  onBack,
  onSongSelect,
  sessionToken,
  initialItems,
  initialNextCursor = null,
  forceInitialLoading = false,
  forceLoadMoreLoading = false,
  initialLoadMoreError = null,
}: CatalogSongListProps) {
  const { duet, genre, hit, language, q, sort } = input;
  const normalizedInput = useMemo(
    () => ({ duet, genre, hit, language, q, sort }),
    [duet, genre, hit, language, q, sort],
  );
  const [state, setState] = useState<CatalogState>({
    items: initialItems ?? [],
    nextCursor: initialNextCursor,
    status: initialItems && !forceInitialLoading ? "ready" : "loading",
  });
  const [isLoadingMore, setIsLoadingMore] = useState(forceLoadMoreLoading);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(initialLoadMoreError);
  const initialControllerRef = useRef<AbortController | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  const loadInitial = useCallback(() => {
    initialControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    initialControllerRef.current = controller;
    setIsLoadingMore(false);
    setLoadMoreError(null);
    setState({ items: [], nextCursor: null, status: "loading" });

    void browseSessionSongs(
      sessionToken,
      { ...normalizedInput, limit: PAGE_SIZE },
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({
          items: uniqueSongs(response.items),
          nextCursor: response.nextCursor,
          status: "ready",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ items: [], nextCursor: null, status: "error" });
      });
  }, [normalizedInput, sessionToken]);

  useEffect(() => {
    if (initialItems || forceInitialLoading) return;
    const start = window.setTimeout(loadInitial, 0);
    return () => {
      window.clearTimeout(start);
      initialControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
    };
  }, [forceInitialLoading, initialItems, loadInitial]);

  const loadMore = useCallback(() => {
    if (!state.nextCursor || isLoadingMore) return;
    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    void browseSessionSongs(
      sessionToken,
      { ...normalizedInput, cursor: state.nextCursor, limit: PAGE_SIZE },
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          items: uniqueSongs([...current.items, ...response.items]),
          nextCursor: response.nextCursor,
          status: "ready",
        }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setLoadMoreError("Nie udało się wczytać kolejnych utworów.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingMore(false);
      });
  }, [isLoadingMore, normalizedInput, sessionToken, state.nextCursor]);

  return (
    <section aria-labelledby="catalog-song-list-heading" className="mb-7">
      <div className="mb-3 flex items-center gap-2">
        <Button
          aria-label={backLabel}
          className="size-11 rounded-full"
          onClick={onBack}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <h1
          className="min-w-0 truncate text-2xl font-extrabold tracking-[-0.04em]"
          id="catalog-song-list-heading"
        >
          {heading}
        </h1>
      </div>

      {state.status === "loading" ? <SongListSkeletons /> : null}
      {state.status === "error" ? (
        <div className="py-4" role="alert">
          <p className="text-sm text-destructive">
            Nie udało się wczytać katalogu. Spróbuj ponownie.
          </p>
          <Button className="mt-3" onClick={loadInitial} size="sm" type="button" variant="outline">
            Spróbuj ponownie
          </Button>
        </div>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground" role="status">
          Nie znaleziono pasujących piosenek.
        </p>
      ) : null}
      {state.items.length > 0 ? (
        <SongRows songs={state.items} onSongSelect={onSongSelect} />
      ) : null}
      {state.status === "ready" && state.nextCursor ? (
        <div className="pt-5">
          {loadMoreError ? (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {loadMoreError}
            </p>
          ) : null}
          <Button disabled={isLoadingMore} onClick={loadMore} type="button" variant="outline">
            {isLoadingMore ? "Ładowanie…" : loadMoreError ? "Spróbuj ponownie" : "Załaduj więcej"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function SongRows({
  songs,
  onSongSelect,
}: {
  songs: PublicSongBrowseItem[];
  onSongSelect: (song: PublicSongBrowseItem) => void;
}) {
  return (
    <ul className="border-t border-border">
      {songs.map((song) => (
        <li key={song.id}>
          <SessionSongRow song={song} onSelect={() => onSongSelect(song)} />
        </li>
      ))}
    </ul>
  );
}

function SongListSkeletons() {
  return (
    <div aria-label="Wczytywanie katalogu" className="border-t border-border">
      {Array.from({ length: 5 }, (_, index) => (
        <div className="flex min-h-[76px] items-center gap-3 border-b border-border py-2" key={index}>
          <Skeleton className="size-14 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/5 max-w-48" />
            <Skeleton className="mt-2 h-3 w-1/4 max-w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

function uniqueSongs(songs: PublicSongBrowseItem[]) {
  return [...new Map(songs.map((song) => [song.id, song])).values()];
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
