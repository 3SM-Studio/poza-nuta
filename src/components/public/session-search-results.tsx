import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicSong } from "./api";
import { SessionSongArtwork } from "./session-song-artwork";
import { formatSongSource } from "./validation";

type SessionSearchResultsProps = {
  isLoading: boolean;
  message: string | null;
  query: string;
  songs: PublicSong[];
  onBack: () => void;
  onSongSelect: (song: PublicSong) => void;
};

export function SessionSearchResults({
  isLoading,
  message,
  query,
  songs,
  onBack,
  onSongSelect,
}: SessionSearchResultsProps) {
  const hasSearchState = isLoading || message !== null || songs.length > 0;
  if (!hasSearchState) return null;

  const isEmpty = message === "Nie znaleziono pasujących piosenek.";
  const isError = message !== null && !isEmpty;

  return (
    <section aria-labelledby="session-search-results-heading" className="mb-7">
      <div className="mb-3 flex items-center gap-2">
        <Button
          aria-label="Wróć do wyszukiwania"
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
          id="session-search-results-heading"
        >
          „{query}”
        </h1>
      </div>

      {isLoading ? <SearchResultSkeletons /> : null}
      {isEmpty ? (
        <p className="py-8 text-center text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
      {isError ? (
        <p className="py-4 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      {songs.length > 0 ? (
        <ul className="border-t border-border">
          {songs.map((song) => (
            <li key={song.id}>
              <button
                className="flex min-h-[76px] w-full items-center gap-3 border-b border-border px-0.5 py-2 text-left transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => onSongSelect(song)}
                type="button"
              >
                <SessionSongArtwork className="size-14" />
                <span className="min-w-0">
                  <span className="block truncate text-base font-extrabold leading-snug tracking-[-0.02em]">
                    {song.title}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {song.artist}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {formatSongSource(song.source)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SearchResultSkeletons() {
  return (
    <div aria-label="Wczytywanie wyników" className="border-t border-border">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          className="flex min-h-[76px] items-center gap-3 border-b border-border py-2"
          key={index}
        >
          <Skeleton className="size-14 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-2/5 max-w-48" />
            <Skeleton className="mt-2 h-3 w-1/4 max-w-28" />
            <Skeleton className="mt-2 h-2.5 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}
