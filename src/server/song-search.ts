import "server-only";

import { sql, type SQL } from "drizzle-orm";

import {
  encodeSongSearchCursor,
  type SongSearchCursor,
} from "../lib/song-search-cursor";
import { tokenizeLegacySongSearchQuery } from "../lib/song-search";
import { isUnicodeSongSearchEnabled } from "../lib/song-search-engine";
import { searchUnicodeCatalogSongs } from "./song-search-unicode";
import { getDb } from "./db";
import { traceDbOperation } from "./db-telemetry";
import { createSongSearchSingleFlight } from "./song-search-single-flight";
import { withSongSearchAdmission } from "./song-search-admission";

export const SONG_SEARCH_RESULT_LIMIT = 50;
export const SONG_SEARCH_STRONG_CANDIDATE_LIMIT = 500;
export const SONG_SEARCH_FUZZY_CANDIDATE_LIMIT = 200;
export const SONG_SEARCH_FUZZY_FILL_THRESHOLD = 100;
export const SONG_SEARCH_FUZZY_THRESHOLD = 0.5;

export type SongSearchRow = {
  id: number;
  source: "ising" | "karafun" | "manual";
  title: string;
  artist: string;
  durationSeconds: number | null;
  isDuet: boolean;
  isExplicit: boolean;
  isPlus: boolean;
  isHit: boolean;
  normalizedTitle: string;
  normalizedArtist: string;
  relevanceTier: number;
  fuzzyRelevance: number;
};

export type SongSearchPage = {
  items: Array<
    Omit<
      SongSearchRow,
      | "normalizedTitle"
      | "normalizedArtist"
      | "relevanceTier"
      | "fuzzyRelevance"
    >
  >;
  nextCursor: string | null;
};

const coalesceSongSearch = createSongSearchSingleFlight<SongSearchPage>();

export async function searchCatalogSongs(
  query: string | null,
  cursor: SongSearchCursor | null = null,
): Promise<SongSearchPage> {
  const unicode = isUnicodeSongSearchEnabled();
  if (query === null || (!unicode && query.length < 2)) {
    return { items: [], nextCursor: null };
  }
  return coalesceSongSearch(getDb(), JSON.stringify([unicode ? 2 : 1, query, cursor]), () =>
    traceDbOperation("song_search", unicode ? "song_search.unicode_v2" : "song_search.legacy", () => loadCatalogSongs(query, cursor, unicode)));
}

async function loadCatalogSongs(query: string, cursor: SongSearchCursor | null, unicode: boolean): Promise<SongSearchPage> {
  if (unicode) return searchUnicodeCatalogSongs(query, cursor);

  const tokens = tokenizeLegacySongSearchQuery(query);
  const phrasePattern = containsPattern(query);
  const tokenPredicate = allTokensMatch(tokens);
  const cursorPredicate = afterSongSearchCursor(cursor);

  return withSongSearchAdmission(async (transaction) => {
    await transaction.execute(
      sql`select set_config('pg_trgm.strict_word_similarity_threshold', ${String(SONG_SEARCH_FUZZY_THRESHOLD)}, true)`,
    );

    const rows = await transaction.execute<SongSearchRow>(sql`
      with ranked_songs as not materialized (
        select
          s.*,
          case
            when s.normalized_title || ' ' || s.normalized_artist = ${query}
              or s.normalized_artist || ' ' || s.normalized_title = ${query} then 1200
            when s.normalized_title = ${query} then 1100
            when s.normalized_artist = ${query} then 1000
            when s.normalized_title || ' ' || s.normalized_artist like ${prefixPattern(query)}
              or s.normalized_artist || ' ' || s.normalized_title like ${prefixPattern(query)} then 900
            when s.normalized_title like ${prefixPattern(query)} then 850
            when s.normalized_artist like ${prefixPattern(query)} then 825
            when ${identityTokenMatch(tokens)} then 750
            when s.normalized_title || ' ' || s.normalized_artist like ${phrasePattern}
              or s.normalized_artist || ' ' || s.normalized_title like ${phrasePattern} then 650
            when s.search_text like ${phrasePattern} then 500
            else 300
          end as relevance_tier,
          greatest(
            similarity(${query}, s.normalized_title),
            similarity(${query}, s.normalized_artist),
            strict_word_similarity(${query}, s.normalized_title),
            strict_word_similarity(${query}, s.normalized_artist),
            strict_word_similarity(${query}, s.normalized_title || ' ' || s.normalized_artist),
            strict_word_similarity(${query}, s.normalized_artist || ' ' || s.normalized_title)
          ) as fuzzy_relevance
        from songs s
      ),
      exact_title_candidates as materialized (
        select id
        from ranked_songs
        where normalized_title = ${query}
        order by relevance_tier desc, fuzzy_relevance desc,
          normalized_artist, normalized_title, source, id
        limit ${SONG_SEARCH_STRONG_CANDIDATE_LIMIT}
      ),
      exact_artist_candidates as materialized (
        select id
        from ranked_songs
        where normalized_artist = ${query}
        order by relevance_tier desc, fuzzy_relevance desc,
          normalized_artist, normalized_title, source, id
        limit ${SONG_SEARCH_STRONG_CANDIDATE_LIMIT}
      ),
      phrase_candidates as materialized (
        select id
        from ranked_songs
        where search_text ilike ${phrasePattern}
        order by relevance_tier desc, fuzzy_relevance desc,
          normalized_artist, normalized_title, source, id
        limit ${SONG_SEARCH_STRONG_CANDIDATE_LIMIT}
      ),
      token_candidates as materialized (
        select id
        from ranked_songs
        where ${tokenPredicate}
        order by relevance_tier desc, fuzzy_relevance desc,
          normalized_artist, normalized_title, source, id
        limit ${SONG_SEARCH_STRONG_CANDIDATE_LIMIT}
      ),
      strong_candidate_ids as materialized (
        select id from exact_title_candidates
        union
        select id from exact_artist_candidates
        union
        select id from phrase_candidates
        union
        select id from token_candidates
      ),
      fuzzy_candidates as materialized (
        select id
        from ranked_songs
        where search_text %>> ${query}
          and (select count(*) from strong_candidate_ids) < ${SONG_SEARCH_FUZZY_FILL_THRESHOLD}
        order by relevance_tier desc, fuzzy_relevance desc,
          normalized_artist, normalized_title, source, id
        limit ${SONG_SEARCH_FUZZY_CANDIDATE_LIMIT}
      ),
      candidate_ids as materialized (
        select id from strong_candidate_ids
        union
        select id from fuzzy_candidates
      ),
      ranked_candidates as materialized (
        select ranked_songs.*
        from ranked_songs
        inner join candidate_ids using (id)
      )
      select
        id,
        source,
        title,
        artist,
        duration_seconds as "durationSeconds",
        is_duet as "isDuet",
        is_explicit as "isExplicit",
        is_plus as "isPlus",
        is_hit as "isHit",
        normalized_title as "normalizedTitle",
        normalized_artist as "normalizedArtist",
        relevance_tier as "relevanceTier",
        fuzzy_relevance as "fuzzyRelevance"
      from ranked_candidates
      where ${cursorPredicate}
      order by relevance_tier desc, fuzzy_relevance desc,
        normalized_artist, normalized_title, source, id
      limit ${SONG_SEARCH_RESULT_LIMIT + 1}
    `);

    return toSongSearchPage(Array.from(rows), query);
  });
}

export function toSongSearchPage(rows: SongSearchRow[], query: string, version: 1 | 2 = 1): SongSearchPage {
  const normalizedRows = rows.map((row) => ({ ...row, id: Number(row.id) }));
  const hasNextPage = normalizedRows.length > SONG_SEARCH_RESULT_LIMIT;
  const pageRows = normalizedRows.slice(0, SONG_SEARCH_RESULT_LIMIT);
  const lastRow = pageRows.at(-1);

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      source: row.source,
      title: row.title,
      artist: row.artist,
      durationSeconds: row.durationSeconds,
      isDuet: row.isDuet,
      isExplicit: row.isExplicit,
      isPlus: row.isPlus,
      isHit: row.isHit,
    })),
    nextCursor:
      hasNextPage && lastRow
        ? encodeSongSearchCursor({
            version,
            query,
            relevanceTier: lastRow.relevanceTier,
            fuzzyRelevance: lastRow.fuzzyRelevance,
            normalizedArtist: lastRow.normalizedArtist,
            normalizedTitle: lastRow.normalizedTitle,
            source: lastRow.source,
            id: lastRow.id,
          })
        : null,
  };
}

function allTokensMatch(tokens: readonly string[]) {
  if (tokens.length === 0) return sql`false`;
  return sql.join(
    tokens.map(
      (token) => sql`search_text ilike ${containsPattern(token)}`,
    ),
    sql` and `,
  );
}

function identityTokenMatch(tokens: readonly string[]) {
  if (tokens.length === 0) return sql`false`;
  return sql.join(
    tokens.map((token) => {
      const pattern = containsPattern(token);
      return sql`(s.normalized_title ilike ${pattern} or s.normalized_artist ilike ${pattern})`;
    }),
    sql` and `,
  );
}

export function afterSongSearchCursor(cursor: SongSearchCursor | null): SQL {
  if (!cursor) return sql`true`;

  return sql`(
    relevance_tier < ${cursor.relevanceTier}
    or (relevance_tier = ${cursor.relevanceTier} and fuzzy_relevance < ${cursor.fuzzyRelevance}::real)
    or (relevance_tier = ${cursor.relevanceTier} and fuzzy_relevance = ${cursor.fuzzyRelevance}::real and normalized_artist > ${cursor.normalizedArtist})
    or (relevance_tier = ${cursor.relevanceTier} and fuzzy_relevance = ${cursor.fuzzyRelevance}::real and normalized_artist = ${cursor.normalizedArtist} and normalized_title > ${cursor.normalizedTitle})
    or (relevance_tier = ${cursor.relevanceTier} and fuzzy_relevance = ${cursor.fuzzyRelevance}::real and normalized_artist = ${cursor.normalizedArtist} and normalized_title = ${cursor.normalizedTitle} and source > ${cursor.source})
    or (relevance_tier = ${cursor.relevanceTier} and fuzzy_relevance = ${cursor.fuzzyRelevance}::real and normalized_artist = ${cursor.normalizedArtist} and normalized_title = ${cursor.normalizedTitle} and source = ${cursor.source} and id > ${cursor.id})
  )`;
}

function containsPattern(input: string) {
  return `%${escapeLikePattern(input)}%`;
}

function prefixPattern(input: string) {
  return `${escapeLikePattern(input)}%`;
}

function escapeLikePattern(input: string) {
  return input.replace(/[\\%_]/g, "\\$&");
}
