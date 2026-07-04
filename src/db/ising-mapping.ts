import { normalizeSongSearchText } from "./karafun-mapping.ts";

export type ISingApiSong = Record<string, unknown>;

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
  song: ISingApiSong,
  checkedAt = new Date(),
): ISingSongPayload | null {
  const sourceSongId = getStableId(song);
  const title = getTrimmedString(song.title);
  const artist = getTrimmedString(song.artist);

  if (!sourceSongId || !title || !artist) {
    return null;
  }

  const subtitle = getTrimmedString(song.subtitle);
  const genres = getStringList(song.genre ?? song.genres);
  const languages = getStringList(song.language ?? song.languages);
  const durationSeconds = getPositiveInteger(song.duration);
  const isDuet = getBoolean(song.duet ?? song.is_duet);
  const isExplicit = getBoolean(song.explicit ?? song.is_explicit);
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
      isExplicit ? "explicit" : null,
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
    isExplicit,
    isPlus,
    isHit,
    sourceUrl,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt,
    createdAt: checkedAt,
    updatedAt: checkedAt,
  };
}

function getStableId(song: ISingApiSong) {
  const id = song.id ?? song.song_id ?? song.songId;

  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }

  return getTrimmedString(id);
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

  const linkRecord = links as Record<string, unknown>;
  return (
    getTrimmedString(linkRecord.permalink) ??
    getTrimmedString(linkRecord.selflink) ??
    null
  );
}
