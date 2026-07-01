import { normalizeSearchText } from "../ising/normalizeSearchText.ts";
import type { LocalSong } from "../../songs/types.ts";
import type { KaraFunCsvRow } from "./types.ts";

export function mapKaraFunSong(row: KaraFunCsvRow, checkedAt = new Date().toISOString()): LocalSong | null {
  const sourceSongId = row.Id.trim();
  const title = row.Title.trim();
  const artist = row.Artist.trim();

  if (!sourceSongId || !title || !artist) {
    return null;
  }

  const genres = splitList(row.Styles);
  const languages = splitList(row.Languages);
  const releaseYear = parseYear(row.Year);
  const isDuet = parseBooleanFlag(row.Duo);
  const isExplicit = parseBooleanFlag(row.Explicit);
  const searchParts = [
    artist,
    title,
    releaseYear === null ? undefined : String(releaseYear),
    ...genres,
    ...languages,
    isDuet ? "duet duo" : undefined,
    isExplicit ? "explicit" : undefined
  ];

  return {
    source: "karafun",
    sourceSongId,
    title,
    subtitle: null,
    artist,
    artistSourceId: null,
    normalizedTitle: normalizeSearchText(title),
    normalizedArtist: normalizeSearchText(artist),
    searchText: normalizeSearchText(searchParts.filter(Boolean).join(" ")),
    durationSeconds: null,
    genres,
    releaseYear,
    languages,
    isDuet,
    isExplicit,
    isPlus: false,
    isHit: false,
    isBuyAvailable: false,
    sourceUrl: null,
    sourceSelflink: null,
    sourceDateAdded: row["Date Added"].trim() || null,
    availabilityStatus: "available",
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt
  };
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseYear(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBooleanFlag(value: string): boolean {
  return value.trim() === "1";
}
