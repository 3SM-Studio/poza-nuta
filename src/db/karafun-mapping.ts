import type { KaraFunCsvRow } from "./karafun-csv";

export type KaraFunSongPayload = {
  source: "karafun";
  sourceSongId: string;
  title: string;
  artist: string;
  normalizedTitle: string;
  normalizedArtist: string;
  searchText: string;
  durationSeconds: number | null;
  genres: string[];
  languages: string[];
  isDuet: boolean;
  isExplicit: boolean;
  isPlus: boolean;
  isHit: boolean;
  sourceUrl: string | null;
  lastSeenAt: Date;
  lastCheckedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export function mapKaraFunRowToSong(
  row: KaraFunCsvRow,
  checkedAt = new Date(),
): KaraFunSongPayload | null {
  const sourceSongId = row.Id.trim();
  const title = row.Title.trim();
  const artist = row.Artist.trim();

  if (!sourceSongId || !title || !artist) {
    return null;
  }

  const genres = splitList(row.Styles);
  const languages = splitList(row.Languages);
  const year = parsePositiveInteger(row.Year);
  const isDuet = parseBooleanFlag(row.Duo);
  const isExplicit = parseBooleanFlag(row.Explicit);
  const searchText = normalizeSongSearchText(
    [
      artist,
      title,
      year === null ? null : String(year),
      ...genres,
      ...languages,
      isDuet ? "duet duo" : null,
      isExplicit ? "explicit" : null,
    ]
      .filter((value): value is string => value !== null)
      .join(" "),
  );

  return {
    source: "karafun",
    sourceSongId,
    title,
    artist,
    normalizedTitle: normalizeSongSearchText(title),
    normalizedArtist: normalizeSongSearchText(artist),
    searchText,
    durationSeconds: null,
    genres,
    languages,
    isDuet,
    isExplicit,
    isPlus: false,
    isHit: false,
    sourceUrl: null,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt,
    createdAt: checkedAt,
    updatedAt: checkedAt,
  };
}

export function normalizeSongSearchText(input: string) {
  return input
    .toLocaleLowerCase("pl-PL")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBooleanFlag(value: string) {
  return value.trim() === "1";
}
