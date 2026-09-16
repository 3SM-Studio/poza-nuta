"use client";

import { useEffect, useState } from "react";

import type { PublicSong, SongDiscoveryCategory } from "./api";
import { browseSessionSongs } from "./session-api";
import { SessionSearchResults } from "./session-search-results";

type GenreResultsState = {
  items: PublicSong[];
  status: "loading" | "ready" | "error";
};

type SessionGenreResultsProps = {
  genre: SongDiscoveryCategory;
  onBack: () => void;
  onSongSelect: (song: PublicSong) => void;
  sessionToken: string;
  initialSongs?: PublicSong[];
};

const GENRE_RESULT_LIMIT = 24;
const EMPTY_GENRE_MESSAGE = "Nie znaleziono piosenek w tym gatunku.";

export function SessionGenreResults({
  genre,
  onBack,
  onSongSelect,
  sessionToken,
  initialSongs,
}: SessionGenreResultsProps) {
  const [results, setResults] = useState<GenreResultsState>(() => ({
    items: initialSongs ?? [],
    status: initialSongs ? "ready" : "loading",
  }));

  useEffect(() => {
    if (initialSongs) return;

    const controller = new AbortController();
    void browseSessionSongs(
      sessionToken,
      { genre: genre.value, limit: GENRE_RESULT_LIMIT },
      controller.signal,
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setResults({ items: response.items, status: "ready" });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResults({ items: [], status: "error" });
      });

    return () => controller.abort();
  }, [genre.value, initialSongs, sessionToken]);

  return (
    <SessionSearchResults
      backLabel="Wróć do odkrywania"
      emptyMessage={EMPTY_GENRE_MESSAGE}
      heading={genre.label}
      isLoading={results.status === "loading"}
      message={
        results.status === "error"
          ? "Nie udało się wczytać piosenek w tym gatunku. Spróbuj ponownie."
          : results.status === "ready" && results.items.length === 0
            ? EMPTY_GENRE_MESSAGE
            : null
      }
      onBack={onBack}
      onSongSelect={onSongSelect}
      query={genre.label}
      songs={results.items}
    />
  );
}
