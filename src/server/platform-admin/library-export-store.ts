import type postgres from "postgres";

export type LibraryExportSong = {
  publicId: string | null;
  source: string;
  sourceSongId: string | null;
  title: string;
  artist: string;
  durationSeconds: number | null;
  genres: string[];
  languages: string[];
  isDuet: boolean;
  isExplicit: boolean;
  isPlus: boolean;
  isHit: boolean;
  sourceUrl: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastSeenAt: Date | string | null;
  lastCheckedAt: Date | string | null;
};

export type LibraryExportDataSource = {
  readSongBatches: (batchSize: number) => AsyncIterable<LibraryExportSong[]>;
};

type LibraryExportDatabase = {
  $client: postgres.Sql;
};

export function createLibraryExportDataSource(
  database: LibraryExportDatabase,
): LibraryExportDataSource {
  return {
    async *readSongBatches(batchSize) {
      const query = database.$client<LibraryExportSong[]>`
        SELECT
          public_id::text AS "publicId",
          source::text AS "source",
          source_song_id AS "sourceSongId",
          title,
          artist,
          duration_seconds AS "durationSeconds",
          genres,
          languages,
          is_duet AS "isDuet",
          is_explicit AS "isExplicit",
          is_plus AS "isPlus",
          is_hit AS "isHit",
          source_url AS "sourceUrl",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_seen_at AS "lastSeenAt",
          last_checked_at AS "lastCheckedAt"
        FROM public.songs
        ORDER BY normalized_artist, normalized_title, source,
          source_song_id NULLS LAST, id
      `;

      for await (const batch of query.cursor(batchSize)) {
        yield batch;
      }
    },
  };
}
