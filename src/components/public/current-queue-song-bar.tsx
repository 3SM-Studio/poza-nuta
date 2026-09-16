import type { PublicQueueItem, PublicQueueResponse } from "./api";
import styles from "./public.module.css";
import { SessionSongArtwork } from "./session-song-artwork";

type CurrentQueueSongBarProps = {
  item: PublicQueueItem;
  showSongTitles: PublicQueueResponse["showSongTitles"];
};

/** The public queue payload's explicit `now` status is the sole current-song signal. */
export function CurrentQueueSongBar({
  item,
  showSongTitles,
}: CurrentQueueSongBarProps) {
  const hasSongDetails = showSongTitles && item.title;

  return (
    <section
      aria-label="Aktualnie wykonywany utwór"
      className={`${styles.currentQueueSongSurface} mb-6 flex items-center gap-3 rounded-xl border border-primary/45 px-3 py-3 text-primary-foreground shadow-[var(--shadow-accent-soft)]`}
    >
      <SessionSongArtwork
        className="size-12 rounded-lg"
        song={{ id: item.id, title: item.title, artist: item.artist }}
      />
      <div className="min-w-0">
        <p className="mb-1 text-[0.68rem] font-extrabold tracking-[0.08em] text-primary-foreground/80 uppercase">
          Teraz gramy
        </p>
        <h2 className="truncate text-base font-extrabold tracking-[-0.02em]">
          {hasSongDetails ? item.title : item.singerName}
        </h2>
        <p className="truncate text-sm text-primary-foreground/80">
          {hasSongDetails ? item.artist : "Tytuł ukryty publicznie"}
        </p>
      </div>
    </section>
  );
}
