export type ISingSearchResponse = {
  data: {
    found: number;
    q: string;
    results: {
      songs: ISingApiSong[];
    };
  };
  links?: {
    next?: string;
    last?: string;
  };
};

export type ISingApiSong = {
  id: number;
  title: string;
  subtitle: string | null;
  artist: string;
  artist_id: number;
  date_added: string | null;
  duration: number | null;
  genre?: string[];
  plus: boolean;
  hit: boolean;
  buy: boolean;
  permalink: string | null;
  links?: {
    selflink?: string;
    permalink?: string;
    selflink_lyrics?: string;
    selflink_recs?: string;
    selflink_battles?: string;
  };
  sample_url?: string;
};

export type { LocalSong, SongSource } from "../../songs/types.ts";

export type ISingImportReport = {
  totalFoundFromApi: number | null;
  importedCount: number;
  skippedCount: number;
  pageCount: number;
  startedAt: string;
  finishedAt: string | null;
  failedAtUrl?: string;
  errors: string[];
};

export type ISingImporterConfig = {
  apiBaseUrl: string;
  clientId: string;
  delayMs: number;
  tag: string;
  order: string;
  contactEmail?: string;
  userAgent?: string;
  outputSongsPath: string;
  outputReportPath: string;
  timeoutMs: number;
  maxNetworkRetries: number;
};
