// Reproducible SQL appendix. No connections, environment files or migrations run.
import { readFileSync, writeFileSync } from "node:fs";
import caseFold from "../src/lib/unicode-case-fold.json" with { type: "json" };

if (process.versions.unicode !== "17.0") throw new Error("Generate with the pinned Unicode 17 Node runtime.");
function ranges(predicate: RegExp) {
  let output = "", start = -1, end = -1;
  function flush() {
    if (start >= 0) output += String.fromCodePoint(start) + (end > start ? "-" + String.fromCodePoint(end) : "");
  }
  for (let point = 1; point <= 0x10ffff; point++) {
    if (predicate.test(String.fromCodePoint(point))) {
      if (start < 0) start = point;
      else if (point !== end + 1) { flush(); start = point; }
      end = point;
    }
  }
  flush();
  return output;
}
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const allowed = ranges(/[\p{Letter}\p{Number}\p{Mark}\s\u200c\u200d]/u);
const marks = ranges(/\p{Mark}/u), latin = ranges(/\p{Script=Latin}/u);
const cjk = ranges(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u);
const whitespace = ranges(/\s/u);
// PostgreSQL 17 and Node need not embed the same Unicode release. Pin scalar
// decompositions too; Hangul decomposition is algorithmic/stable in both.
const decompositions: Record<string, string> = {};
for (let point = 1; point <= 0x10ffff; point++) {
  if (point >= 0xac00 && point <= 0xd7a3) continue;
  const char = String.fromCodePoint(point), normalized = char.normalize("NFKD");
  if (char !== normalized) decompositions[char] = normalized;
}
const appendix = `
-- Generated Unicode 17 C/F case-fold table; original Unicode data license:
-- https://www.unicode.org/license.txt . Regenerate with scripts/generate-unicode-search-sql.ts.
CREATE FUNCTION public.kunestu_search_normalize_v2(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE
  folds constant jsonb := ${literal(JSON.stringify(caseFold))}::jsonb;
  decompositions constant jsonb := ${literal(JSON.stringify(decompositions))}::jsonb;
  result text := ''; expanded text := ''; codepoint text;
BEGIN
  FOREACH codepoint IN ARRAY string_to_array(input, NULL) LOOP
    expanded := expanded || coalesce(decompositions ->> codepoint, codepoint);
  END LOOP;
  FOREACH codepoint IN ARRAY string_to_array(normalize(expanded, NFKD), NULL) LOOP
    result := result || coalesce(folds ->> codepoint, codepoint);
  END LOOP;
  result := regexp_replace(normalize(result, NFD), ${literal("([" + latin + "])[" + marks + "]+")}, '\\1', 'g');
  result := replace(replace(translate(result, 'łøđ', 'lod'), 'æ', 'ae'), 'œ', 'oe');
  result := translate(result, U&'\\061c\\200e\\200f\\202a\\202b\\202c\\202d\\202e\\2066\\2067\\2068\\2069', '');
  result := regexp_replace(result, ${literal("[^" + allowed + "]")}, ' ', 'g');
  RETURN btrim(regexp_replace(result, ${literal("[" + whitespace + "]+")}, ' ', 'g'));
END $$;
--> statement-breakpoint
CREATE FUNCTION public.kunestu_search_grams_v2(input text) RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT coalesce(array_agg(DISTINCT gram ORDER BY gram), '{}'::text[]) FROM (
    SELECT substring(input FROM n FOR 2) AS gram FROM generate_series(1, length(input) - 1) AS n
      WHERE substring(input FROM n FOR 2) !~ ${literal("[" + whitespace + "]")}
    UNION ALL
    SELECT substring(input FROM n FOR 1) FROM generate_series(1, length(input)) AS n
      WHERE substring(input FROM n FOR 1) ~ ${literal("[" + cjk + "]")}
  ) grams;
$$;
--> statement-breakpoint
CREATE FUNCTION public.kunestu_refresh_song_search_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE title_key text; artist_key text; document_key text;
BEGIN
  title_key := public.kunestu_search_normalize_v2(NEW.title);
  artist_key := public.kunestu_search_normalize_v2(NEW.artist);
  document_key := public.kunestu_search_normalize_v2(concat_ws(' ', NEW.title, NEW.artist, NEW.search_text, array_to_string(NEW.genres, ' '), array_to_string(NEW.languages, ' ')));
  INSERT INTO public.song_search_documents (song_id, normalized_title, normalized_artist, search_text, short_grams, normalization_version)
    VALUES (NEW.id, title_key, artist_key, document_key, public.kunestu_search_grams_v2(document_key), 2)
    ON CONFLICT (song_id) DO UPDATE SET normalized_title=excluded.normalized_title, normalized_artist=excluded.normalized_artist,
      search_text=excluded.search_text, short_grams=excluded.short_grams, normalization_version=2;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER songs_unicode_search_refresh AFTER INSERT OR UPDATE OF title, artist, search_text, genres, languages
ON public.songs FOR EACH ROW EXECUTE FUNCTION public.kunestu_refresh_song_search_v2();
--> statement-breakpoint
CREATE FUNCTION public.kunestu_normalize_song_alias_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  NEW.normalized_value := public.kunestu_search_normalize_v2(NEW.value);
  NEW.short_grams := public.kunestu_search_grams_v2(NEW.normalized_value);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER song_search_aliases_normalize BEFORE INSERT OR UPDATE
ON public.song_search_aliases FOR EACH ROW EXECUTE FUNCTION public.kunestu_normalize_song_alias_v2();
--> statement-breakpoint
REVOKE ALL ON TABLE public.song_search_documents, public.song_search_aliases FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.kunestu_search_normalize_v2(text), public.kunestu_search_grams_v2(text),
  public.kunestu_refresh_song_search_v2(), public.kunestu_normalize_song_alias_v2() FROM PUBLIC, anon, authenticated;
-- No eager catalog rewrite. Backfill is batched, restartable and separately authorized.
-- Rollback reads: SONG_SEARCH_ENGINE=legacy. Keep projection, triggers and original songs.
`;
const path = "drizzle/0031_unicode_song_search.sql";
const original = readFileSync(path, "utf8").split("-- Generated Unicode 17 C/F")[0].replace(/(?:\s*--> statement-breakpoint\s*)+$/, "").trimEnd();
writeFileSync(path, original + "\n--> statement-breakpoint\n" + appendix.trimStart());
