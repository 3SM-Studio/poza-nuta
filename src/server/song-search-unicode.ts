import "server-only";
import { sql } from "drizzle-orm";
import { canFuzzySearchSongs, isMeaningfulSongSearch, normalizeSongSearchQuery, songSearchGrams, tokenizeSongSearchQuery } from "../lib/song-search";
import type { SongSearchCursor } from "../lib/song-search-cursor";
import { withSongSearchAdmission } from "./song-search-admission";
import { afterSongSearchCursor, toSongSearchPage, type SongSearchRow } from "./song-search";

export function searchGramArray(query: string) {
  return sql`ARRAY[${sql.join(songSearchGrams(query).map(gram => sql`${gram}`), sql`, `)}]::text[]`;
}

export function unicodeBrowsePredicate(query: string) {
  if (songSearchGrams(query).length === 0) return sql`exists (select 1 from song_search_documents d
    where d.song_id = ${sql.identifier("songs")}.id and (d.normalized_title = ${query} or d.normalized_artist = ${query}))`;
  return sql`exists (select 1 from song_search_documents d
    where d.song_id = ${sql.identifier("songs")}.id and d.short_grams @> ${searchGramArray(query)}
    and d.search_text like ${contains(query)})`;
}

export async function searchUnicodeCatalogSongs(rawQuery: string | null, cursor: SongSearchCursor | null) {
  if (rawQuery && rawQuery.length > 400) return { items: [], nextCursor: null };
  const query = rawQuery ? normalizeSongSearchQuery(rawQuery) : null;
  if (!query || !isMeaningfulSongSearch(query)) return { items: [], nextCursor: null };
  const hasGrams = songSearchGrams(query).length > 0;
  const tokens = tokenizeSongSearchQuery(query);
  const allTokens = tokens.length ? sql.join(tokens.map(token => sql`d.search_text like ${contains(token)}`), sql` and `) : sql`false`;
  const identityTokens = tokens.length ? sql.join(tokens.map(token => sql`(d.normalized_title like ${contains(token)} or d.normalized_artist like ${contains(token)})`), sql` and `) : sql`false`;
  const canFuzzy = hasGrams && canFuzzySearchSongs(query);
  // The expression GiST index cannot divert literal/short-query plans from GIN.
  // Single-word dense ties keep the original GIN/scan strategy. For multi-word
  // fuzzy KNN, score DESC breaks rounded-distance ties before the original ID.
  // Distance is monotonic in score; candidate membership/order remain identical.
  const fuzzyText = tokens.length > 1 ? sql`(search_text || '')` : sql`search_text`;
  const fuzzyOrder = tokens.length > 1
    ? sql`${fuzzyText} <->>> ${query}, strict_word_similarity(${query}, search_text) desc, song_id`
    : sql`strict_word_similarity(${query}, search_text) desc, song_id`;
  const tier = sql`case
    when d.normalized_title || ' ' || d.normalized_artist = ${query} or d.normalized_artist || ' ' || d.normalized_title = ${query} then 1200
    when d.normalized_title = ${query} then 1100
    when d.normalized_artist = ${query} then 1000
    when d.normalized_title || ' ' || d.normalized_artist like ${prefix(query)} or d.normalized_artist || ' ' || d.normalized_title like ${prefix(query)} then 900
    when d.normalized_title like ${prefix(query)} then 850
    when d.normalized_artist like ${prefix(query)} then 825
    when ${identityTokens} then 750
    when d.normalized_title || ' ' || d.normalized_artist like ${contains(query)} or d.normalized_artist || ' ' || d.normalized_title like ${contains(query)} then 650
    when d.search_text like ${contains(query)} then 500 else 300 end`;
  return withSongSearchAdmission(async transaction => {
    await transaction.execute(sql`select set_config('statement_timeout', '2000', true),
      set_config('pg_trgm.strict_word_similarity_threshold', '0.5', true)`);
    const rows = await transaction.execute<SongSearchRow>(sql`
      with exact_title as materialized (
        select song_id from song_search_documents where normalized_title = ${query} order by song_id limit 500
      ), exact_artist as materialized (
        select song_id from song_search_documents where normalized_artist = ${query} order by song_id limit 500
      ), literal_candidates as materialized (
        select d.song_id from song_search_documents d
        where ${hasGrams} and d.short_grams @> ${searchGramArray(query)} and (d.search_text like ${contains(query)} or (${allTokens}))
        order by ${tier} desc, d.normalized_artist collate "C", d.normalized_title collate "C", d.song_id limit 500
      ), strong as materialized (
        select song_id from exact_title union select song_id from exact_artist union select song_id from literal_candidates
      ), alias_candidates as materialized (
        select a.song_id, max(case when a.normalized_value = ${query} then 450 when a.normalized_value like ${prefix(query)} then 400 else 350 end) as alias_tier
        from song_search_aliases a where a.normalized_value = ${query}
          or (${hasGrams} and a.short_grams @> ${searchGramArray(query)} and a.normalized_value like ${contains(query)})
        group by a.song_id order by alias_tier desc, a.song_id limit 200
      ), fuzzy_candidates as materialized (
        select song_id from song_search_documents
        where ${canFuzzy} and (select count(*) from strong) < 100 and ${fuzzyText} %>> ${query}
        order by ${fuzzyOrder} limit 200
      ), candidates as materialized (
        select song_id from strong union select song_id from alias_candidates union select song_id from fuzzy_candidates
      ), ranked as materialized (
        select s.id, s.source, s.title, s.artist, s.duration_seconds, s.is_duet, s.is_explicit, s.is_plus, s.is_hit,
          d.normalized_title collate "C" as normalized_title, d.normalized_artist collate "C" as normalized_artist,
          greatest(${tier}, coalesce(a.alias_tier, 0)) as relevance_tier,
          case when ${canFuzzy} then greatest(similarity(${query}, d.normalized_title), similarity(${query}, d.normalized_artist),
            strict_word_similarity(${query}, d.normalized_title), strict_word_similarity(${query}, d.normalized_artist),
            strict_word_similarity(${query}, d.normalized_title || ' ' || d.normalized_artist),
            strict_word_similarity(${query}, d.normalized_artist || ' ' || d.normalized_title)) else 0::real end as fuzzy_relevance
        from candidates c join songs s on s.id = c.song_id join song_search_documents d on d.song_id = s.id
        left join alias_candidates a on a.song_id = s.id
      ) select id, source, title, artist, duration_seconds as "durationSeconds", is_duet as "isDuet", is_explicit as "isExplicit",
        is_plus as "isPlus", is_hit as "isHit", normalized_title as "normalizedTitle", normalized_artist as "normalizedArtist",
        relevance_tier as "relevanceTier", fuzzy_relevance as "fuzzyRelevance"
      from ranked where ${afterSongSearchCursor(cursor)}
      order by relevance_tier desc, fuzzy_relevance desc, normalized_artist, normalized_title, source, id limit 51
    `);
    return toSongSearchPage(Array.from(rows), query, 2);
  });
}

function escaped(query: string) { return query.replace(/[\\%_]/g, "\\$&"); }
function contains(query: string) { return `%${escaped(query)}%`; }
function prefix(query: string) { return `${escaped(query)}%`; }
