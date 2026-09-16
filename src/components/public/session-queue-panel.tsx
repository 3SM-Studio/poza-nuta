"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import type { PublicQueueItem, PublicQueueResponse } from "./api";
import { SessionQueueList } from "./session-queue-list";
import { SessionSongArtwork } from "./session-song-artwork";

type SessionQueuePanelProps = {
  message: string | null;
  onOpen: () => void;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  open: boolean;
  queue: PublicQueueResponse | null;
  refreshing: boolean;
};

/** One queue state, presented as a desktop panel and a mobile expanding bar. */
export function SessionQueuePanel({
  message,
  onOpen,
  onOpenChange,
  onRefresh,
  open,
  queue,
  refreshing,
}: SessionQueuePanelProps) {
  return (
    <>
      <aside
        aria-label="Kolejka sesji"
        className="hidden min-h-0 w-[clamp(22.5rem,30vw,27.5rem)] shrink-0 border-l border-border bg-secondary/35 lg:flex lg:flex-col"
      >
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-7"
          tabIndex={0}
        >
          <SessionQueueList
            className="max-w-none"
            message={message}
            onRefresh={onRefresh}
            queue={queue}
            refreshing={refreshing}
          />
        </div>
      </aside>

      <Drawer onOpenChange={onOpenChange} open={open}>
        <DrawerTrigger asChild>
          <button
            aria-label="Otwórz kolejkę"
            className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-popover px-3 text-left text-foreground shadow-[var(--shadow-panel)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35 lg:hidden motion-reduce:transform-none motion-reduce:transition-none"
            onClick={onOpen}
            type="button"
          >
            <CollapsedQueueSummary queue={queue} />
            <ChevronUp aria-hidden="true" className="ml-auto size-5 shrink-0 text-muted-foreground" />
          </button>
        </DrawerTrigger>

        <DrawerContent
          className="h-[calc(100dvh-0.5rem)] max-h-none border-x-0 border-t border-border bg-popover text-foreground lg:hidden"
          overlayClassName="bg-black/25 lg:hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <DrawerTitle className="sr-only">Kolejka</DrawerTitle>
            <div className="flex shrink-0 justify-end px-4 pb-1">
              <DrawerClose asChild>
                <Button
                  aria-label="Zwiń kolejkę"
                  className="size-11 rounded-full"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DrawerClose>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <SessionQueueList
                className="max-w-none"
                message={message}
                onRefresh={onRefresh}
                queue={queue}
                refreshing={refreshing}
              />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function CollapsedQueueSummary({ queue }: { queue: PublicQueueResponse | null }) {
  const currentItem = queue?.items.find((item) => item.status === "now");

  if (currentItem && queue) {
    return <CurrentSongSummary item={currentItem} showSongTitles={queue.showSongTitles} />;
  }

  const itemCount = queue?.items.length;
  const subtitle =
    itemCount === undefined
      ? "Wczytywanie kolejki…"
      : itemCount === 0
        ? "Brak utworów"
        : formatSongCount(itemCount);

  return (
    <div className="min-w-0">
      <p className="truncate text-base font-extrabold tracking-[-0.02em]">Kolejka</p>
      <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function CurrentSongSummary({
  item,
  showSongTitles,
}: {
  item: PublicQueueItem;
  showSongTitles: boolean;
}) {
  const hasSongDetails = showSongTitles && item.title;

  return (
    <>
      <SessionSongArtwork
        className="size-10 shrink-0 rounded-xl"
        song={{ id: item.id, title: item.title, artist: item.artist }}
      />
      <div className="min-w-0">
        <p className="truncate text-base font-extrabold tracking-[-0.02em]">
          {hasSongDetails ? item.title : item.singerName}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {hasSongDetails ? item.artist : "Tytuł ukryty publicznie"}
        </p>
      </div>
    </>
  );
}

function formatSongCount(count: number) {
  if (count === 1) return "1 utwór";
  if (
    count % 10 >= 2 &&
    count % 10 <= 4 &&
    (count % 100 < 12 || count % 100 > 14)
  ) {
    return `${count} utwory`;
  }
  return `${count} utworów`;
}
