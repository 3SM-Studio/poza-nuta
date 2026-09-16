import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PublicQueueResponse } from "./api";
import { CurrentQueueSongBar } from "./current-queue-song-bar";
import { SessionSongArtwork } from "./session-song-artwork";

type SessionQueueListProps = {
  className?: string;
  message: string | null;
  queue: PublicQueueResponse | null;
  refreshing: boolean;
  onRefresh: () => void;
  ownSingerName?: string;
};

export function SessionQueueList({
  className,
  message,
  queue,
  refreshing,
  onRefresh,
  ownSingerName,
}: SessionQueueListProps) {
  const headingId = useId();
  const itemCount = queue?.items.length ?? 0;
  const currentItem = queue?.items.find((item) => item.status === "now");
  const upcomingItems = queue?.items.filter((item) => item.status !== "now") ?? [];

  return (
    <section aria-labelledby={headingId} className={cn("mx-auto w-full max-w-2xl", className)}>
      {currentItem && queue ? (
        <CurrentQueueSongBar
          item={currentItem}
          showSongTitles={queue.showSongTitles}
        />
      ) : null}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 id={headingId} className="text-3xl font-extrabold tracking-[-0.04em]">
            Kolejka
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatSongCount(itemCount)} w kolejce
          </p>
        </div>
      </div>

      {message ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-destructive" role="alert">{message}</p>
          <Button disabled={refreshing} onClick={onRefresh} size="sm" type="button" variant="ghost">
            {refreshing ? "Odświeżam…" : "Spróbuj ponownie"}
          </Button>
        </div>
      ) : null}
      {queue === null ? (
        <div aria-label="Wczytywanie kolejki" className="mt-4 flex items-center gap-3 border-b border-border py-4">
          <Skeleton className="size-12 shrink-0 rounded-lg" />
          <div><Skeleton className="h-3.5 w-44" /><Skeleton className="mt-2 h-3 w-28" /></div>
        </div>
      ) : !currentItem && upcomingItems.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Kolejka nie ma jeszcze publicznie widocznych zgłoszeń.</p>
      ) : (
        <div>
          {upcomingItems.map((item) => (
            <article className="flex items-center gap-3 border-b border-border py-4 first:pt-0" key={item.id}>
              <SessionSongArtwork
                className="size-12 rounded-lg"
                song={{ id: item.id, title: item.title, artist: item.artist }}
              />
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-[0.68rem] font-extrabold tracking-[0.08em] text-primary uppercase">#{item.position}</p>
                  {ownSingerName && item.singerName === ownSingerName ? (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[0.62rem] font-extrabold tracking-[0.07em] text-primary uppercase">Twoje</span>
                  ) : null}
                </div>
                {queue.showSongTitles && item.title ? (
                  <>
                    <h2 className="truncate text-base font-bold tracking-[-0.02em]">{item.title}</h2>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{item.artist}</p>
                  </>
                ) : (
                  <>
                    <h2 className="truncate text-base font-bold tracking-[-0.02em]">{item.singerName}</h2>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">Tytuł ukryty publicznie</p>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatSongCount(count: number) {
  if (count === 1) return "1 utwór";
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) {
    return `${count} utwory`;
  }
  return `${count} utworów`;
}
