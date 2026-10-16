import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// No source data is updated. Row locks prevent a source edit from racing an
// older projection; SKIP LOCKED permits concurrent workers and restartability.
export async function backfillUnicodeSongSearchBatch(database: PostgresJsDatabase, limit = 250) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid backfill batch size.");
  return database.transaction(async transaction => {
    await transaction.execute(sql`select set_config('lock_timeout', '1000', true), set_config('statement_timeout', '30000', true)`);
    const result = await transaction.execute<{ song_id: number }>(sql`
      with source_rows as materialized (
        select s.* from songs s where not exists (
          select 1 from song_search_documents d where d.song_id=s.id and d.normalization_version=2
        ) order by s.id limit ${limit} for update of s skip locked
      ), normalized as materialized (
        select id, public.kunestu_search_normalize_v2(title) as title_key, public.kunestu_search_normalize_v2(artist) as artist_key,
          public.kunestu_search_normalize_v2(concat_ws(' ', title, artist, search_text, array_to_string(genres, ' '), array_to_string(languages, ' '))) as text_key from source_rows
      ) insert into song_search_documents (song_id, normalized_title, normalized_artist, search_text, short_grams, normalization_version)
        select id, title_key, artist_key, text_key, public.kunestu_search_grams_v2(text_key), 2 from normalized
        on conflict (song_id) do update set normalized_title=excluded.normalized_title, normalized_artist=excluded.normalized_artist,
          search_text=excluded.search_text, short_grams=excluded.short_grams, normalization_version=2 returning song_id
    `);
    return result.length;
  });
}
