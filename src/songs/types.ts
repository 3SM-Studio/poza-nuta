export type SongSource = "ising" | "karafun";

export type LocalSong = {
  source: SongSource;
  sourceSongId: string;
  title: string;
  subtitle: string | null;
  artist: string;
  artistSourceId: string | null;
  normalizedTitle: string;
  normalizedArtist: string;
  searchText: string;
  durationSeconds: number | null;
  genres: string[];
  releaseYear?: number | null;
  languages?: string[];
  isDuet?: boolean;
  isExplicit?: boolean;
  isPlus: boolean;
  isHit: boolean;
  isBuyAvailable: boolean;
  sourceUrl: string | null;
  sourceSelflink: string | null;
  sourceDateAdded: string | null;
  availabilityStatus: "available";
  lastSeenAt: string;
  lastCheckedAt: string;
};
