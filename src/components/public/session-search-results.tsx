
import { useUiText } from "@/i18n/use-ui-text";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PublicSong } from "./api";
import { SessionSongRow } from "./session-song-row";

type SessionSearchResultsProps = {
  isLoading: boolean;
  isLoadingMore?: boolean;
  message: string | null;
  query: string;
  songs: PublicSong[];
  onBack: () => void;
  onSongSelect: (song: PublicSong) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  heading?: string;
  backLabel?: string;
  emptyMessage?: string;
};

export function SessionSearchResults({
  isLoading,
  isLoadingMore = false,
  message,
  query,
  songs,
  onBack,
  onSongSelect,
  onLoadMore,
  hasMore = false,
  heading = `„${query}”`,
  backLabel = "Wróć do katalogu",
  emptyMessage = "Brak wyników. Spróbuj wpisać tytuł i wykonawcę.",
}: SessionSearchResultsProps) {
  const tx = useUiText();

  const hasSearchState = isLoading || message !== null || songs.length > 0;
  if (!hasSearchState) return null;

  const isEmpty = message === emptyMessage;
  const isError = message !== null && !isEmpty;

  return (
    <section aria-labelledby="session-search-results-heading" className="mb-7">
      <div className="mb-3 flex items-center gap-2">
        <Button
          aria-label={tx(backLabel)}
          className="size-11 rounded-full"
          onClick={onBack}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <h1
          dir="auto"
          className="min-w-0 truncate text-2xl font-extrabold tracking-[-0.04em]"
          id="session-search-results-heading"
        >
          {heading}
        </h1>
      </div>

      {isLoading && songs.length === 0 ? <SearchResultSkeletons /> : null}
      {isLoading && songs.length > 0 ? (
        <p className="mb-2 text-sm text-muted-foreground" role="status">
          {tx("Aktualizowanie wyników…")}</p>
      ) : null}
      {isEmpty ? (
        <p className="py-8 text-center text-sm text-muted-foreground" role="status">
          {tx(message)}
        </p>
      ) : null}
      {isError ? (
        <p className="py-4 text-sm text-destructive" role="alert">
          {tx(message)}
        </p>
      ) : null}
      {songs.length > 0 ? (
        <>
          <ul className="border-t border-border">
            {songs.map((song) => (
              <li key={song.id}>
                <SessionSongRow song={song} onSelect={onSongSelect} />
              </li>
            ))}
          </ul>
          {hasMore && onLoadMore ? (
            <div className="flex justify-center pt-4">
              <Button
                disabled={isLoadingMore}
                onClick={() => {
                  onLoadMore();
                  document.getElementById("session-song-search")?.focus({
                    preventScroll: true,
                  });
                }}
                type="button"
                variant="outline"
              >
                {isLoadingMore ? tx("Wczytywanie…") : tx("Pokaż więcej")}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function SearchResultSkeletons() {
  const tx = useUiText();

  return (
    <div aria-label={tx("Wczytywanie wyników")} className="border-t border-border">
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
