import type { ISingApiSong } from "./ising-client.ts";
import { normalizeSongSearchText } from "./karafun-mapping.ts";

export type { ISingApiSong } from "./ising-client.ts";

export type ISingMetadataEnrichment = {
  languagesBySourceSongId: ReadonlyMap<string, ReadonlySet<string>>;
  duetSourceSongIds: ReadonlySet<string>;
};

export type ISingSongPayload = {
  source: "ising";
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

export function mapISingSongToSong(
  rawSong: unknown,
  checkedAt = new Date(),
  enrichment?: ISingMetadataEnrichment,
): ISingSongPayload | null {
  const song = asISingApiSong(rawSong);
  if (!song) return null;

  const sourceSongId = getISingSourceSongId(song);
  const title = getTrimmedString(song.title);
  const artist = getTrimmedString(song.artist);

  if (!sourceSongId || !title || !artist) {
    return null;
  }

  const subtitle = getTrimmedString(song.subtitle);
  const genres = getStringList(song.genre);
  const languages = getEnrichedLanguages(enrichment, sourceSongId);
  const durationSeconds = getPositiveInteger(song.duration);
  const isDuet = enrichment?.duetSourceSongIds.has(sourceSongId) ?? false;
  const isPlus = getBoolean(song.plus);
  const isHit = getBoolean(song.hit);
  const sourceUrl = getSourceUrl(song);
  const searchText = normalizeSongSearchText(
    [
      artist,
      title,
      subtitle,
      ...genres,
      ...languages,
      isDuet ? "duet duo" : null,
      isPlus ? "plus" : null,
      isHit ? "hit" : null,
    ]
      .filter((value): value is string => value !== null)
      .join(" "),
  );

  return {
    source: "ising",
    sourceSongId,
    title,
    artist,
    normalizedTitle: normalizeSongSearchText(title),
    normalizedArtist: normalizeSongSearchText(artist),
    searchText,
    durationSeconds,
    genres,
    languages,
    isDuet,
    // The verified /v2/search payload has no explicit-content field.
    isExplicit: false,
    isPlus,
    isHit,
    sourceUrl,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt,
    createdAt: checkedAt,
    updatedAt: checkedAt,
  };
}

export function getISingSourceSongId(rawSong: unknown) {
  const song = asISingApiSong(rawSong);
  if (!song) return null;

  const id = song.id ?? song.song_id ?? song.songId;

  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }

  return getTrimmedString(id);
}

function asISingApiSong(value: unknown): ISingApiSong | null {
  return typeof value === "object" && value !== null
    ? (value as ISingApiSong)
    : null;
}

function getEnrichedLanguages(
  enrichment: ISingMetadataEnrichment | undefined,
  sourceSongId: string,
) {
  const values = enrichment?.languagesBySourceSongId.get(sourceSongId);
  if (!values) return [];

  return Array.from(values)
    .filter((value) => value.trim().length > 0)
    .sort((left, right) => left.localeCompare(right, "en-US"));
}

function getTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => getTrimmedString(item))
      .filter((item): item is string => item !== null);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getPositiveInteger(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : null;

  return parsed !== null && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function getBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function getSourceUrl(song: ISingApiSong) {
  const directUrl = getTrimmedString(song.permalink);
  if (directUrl) {
    return directUrl;
  }

  const links = song.links;
  if (!links || typeof links !== "object") {
    return null;
  }

  return (
    getTrimmedString(links.permalink) ??
    getTrimmedString(links.selflink) ??
    null
  );
}
