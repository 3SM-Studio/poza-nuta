import { normalizeSearchText } from "./normalizeSearchText.ts";
import type { LocalSong } from "../../songs/types.ts";
import type { ISingApiSong } from "./types.ts";

export function mapISingSong(song: ISingApiSong, checkedAt = new Date().toISOString()): LocalSong {
  const genres = Array.isArray(song.genre) ? song.genre.filter((genre) => typeof genre === "string") : [];
  const subtitle = song.subtitle ?? null;

  return {
    source: "ising",
    sourceSongId: String(song.id),
    title: song.title,
    subtitle,
    artist: song.artist,
    artistSourceId: Number.isFinite(song.artist_id) ? String(song.artist_id) : null,
    normalizedTitle: normalizeSearchText(song.title),
    normalizedArtist: normalizeSearchText(song.artist),
    searchText: normalizeSearchText([song.artist, song.title, subtitle, ...genres].filter(Boolean).join(" ")),
    durationSeconds: typeof song.duration === "number" ? song.duration : null,
    genres,
    isPlus: Boolean(song.plus),
    isHit: Boolean(song.hit),
    isBuyAvailable: Boolean(song.buy),
    sourceUrl: song.permalink ?? null,
    sourceSelflink: song.links?.selflink ?? null,
    sourceDateAdded: song.date_added ?? null,
    availabilityStatus: "available",
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt
  };
}
