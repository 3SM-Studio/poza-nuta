"use client";

import { useUiText } from "@/i18n/use-ui-text";

import { Clock3, X } from "lucide-react";
import { useRef } from "react";

import { SessionStateAlert, type SessionStateAlertKind } from "@/components/public/session-state-alert";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { PublicSong } from "./api";
import { SessionSongArtwork } from "./session-song-artwork";
import { formatSongSource } from "./validation";

type SongDetailsDrawerProps = {
  alert: SessionStateAlertKind | null;
  isOpen: boolean;
  isSubmitting: boolean;
  song: PublicSong | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
};

export function SongDetailsDrawer({
  alert,
  isOpen,
  isSubmitting,
  song,
  onOpenChange,
  onSubmit,
}: SongDetailsDrawerProps) {
  const tx = useUiText();

  const returnFocusRef = useRef<HTMLElement | null>(null);
  if (!song) return null;

  return (
    <Drawer onOpenChange={onOpenChange} open={isOpen}>
      <DrawerContent
        className="max-h-[82dvh] border-border bg-popover text-foreground data-[vaul-drawer-direction=bottom]:sm:left-[max(2rem,calc(50%-20rem))] data-[vaul-drawer-direction=bottom]:sm:right-auto data-[vaul-drawer-direction=bottom]:sm:w-[min(calc(100%-4rem),40rem)] sm:rounded-t-2xl sm:border-x"
        onCloseAutoFocus={(event) => {
          const returnFocusTarget = returnFocusRef.current;
          returnFocusRef.current = null;
          if (!returnFocusTarget?.isConnected) return;
          event.preventDefault();
          returnFocusTarget.focus({ preventScroll: true });
        }}
        onOpenAutoFocus={() => {
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
      >
        <DrawerHeader className="relative flex-row items-start gap-4 px-6 pt-5 pb-4 text-left">
          <SessionSongArtwork className="size-16" song={song} />
          <div className="min-w-0 pt-0.5">
            <DrawerTitle dir="auto" className="truncate pr-10 text-xl font-extrabold tracking-[-0.035em]">
              {song.title}
            </DrawerTitle>
            <p dir="auto" className="mt-1 truncate text-sm text-muted-foreground">{song.artist}</p>
          </div>
          <DrawerClose asChild>
            <Button
              aria-label={tx("Zamknij szczegóły utworu")}
              className="absolute top-4 right-4 size-11 rounded-full"
              disabled={isSubmitting}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="border-y border-border px-6 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span>{tx(formatSongSource(song.source))}</span>
            {song.durationSeconds !== null ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock3 aria-hidden="true" className="size-4" />
                {formatDuration(song.durationSeconds)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="session-scrollbar max-h-[calc(82dvh-9rem)] overflow-y-auto px-6 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {alert ? <SessionStateAlert kind={alert} /> : null}
          <Button
            className="h-12 w-full rounded-full font-extrabold"
            disabled={isSubmitting}
            onClick={onSubmit}
            type="button"
          >
            {isSubmitting ? tx("Dodaję…") : tx("Dodaj do kolejki")}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
