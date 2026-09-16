"use client";

import type { PublicSong } from "./api";
import { SessionSongArtwork } from "./session-song-artwork";
import { formatSongSource } from "./validation";

type SessionSongRowProps = {
  song: PublicSong;
  onSelect: (song: PublicSong) => void;
};

export function SessionSongRow({ song, onSelect }: SessionSongRowProps) {
  return (
    <button
      className="flex min-h-[76px] w-full items-center gap-3 border-b border-border px-0.5 py-2 text-left transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      data-slot="session-song-row"
      onClick={() => onSelect(song)}
      type="button"
    >
      <SessionSongArtwork className="size-14" song={song} />
      <span className="min-w-0 flex-1 text-left" data-slot="session-song-row-text">
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
  );
}
