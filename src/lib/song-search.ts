import caseFoldData from "./unicode-case-fold.json" with { type: "json" };

export const SONG_SEARCH_MAX_TOKENS = 16;
const caseFold: Readonly<Record<string, string>> = caseFoldData;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

// Unicode 17 full default case folding (C/F, not locale-specific Turkic T).
// Source/license: https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt
export function normalizeSongSearchText(input: string) {
  const folded = Array.from(input.normalize("NFKD"), char => caseFold[char] ?? char).join("");
  return folded.normalize("NFD")
    .replace(/(\p{Script=Latin})\p{Mark}+/gu, "$1")
    .replace(/[łøđ]/g, char => ({ ł: "l", ø: "o", đ: "d" })[char] ?? char)
    .replace(/æ/g, "ae").replace(/œ/g, "oe")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\u200c\u200d\s]/gu, " ")
    .replace(/\s+/gu, " ").trim();
}

export function normalizeSongSearchQuery(input: string) {
  return normalizeSongSearchText(input);
}

export function isMeaningfulSongSearch(query: string) {
  const lettersAndNumbers = Array.from(query).filter(char => /[\p{Letter}\p{Number}]/u.test(char));
  return lettersAndNumbers.length >= 2 || (lettersAndNumbers.length === 1 && cjk.test(lettersAndNumbers[0]));
}

export function songSearchGrams(text: string) {
  const grams = new Set<string>();
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index++) {
    if (cjk.test(chars[index])) grams.add(chars[index]);
    if (index + 1 < chars.length && !/\s/u.test(chars[index] + chars[index + 1])) grams.add(chars[index] + chars[index + 1]);
  }
  return [...grams].sort();
}

export function canFuzzySearchSongs(query: string) {
  return Array.from(query.replace(/\s/g, "")).length >= 3
    && /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Mark}\p{Number}\s]+$/u.test(query);
}

// Keep the existing projection untouched for a data-preserving rollback.
export function normalizeLegacySongSearchText(input: string, form: "NFD" | "NFKD" = "NFD") {
  return input
    .toLocaleLowerCase("pl-PL")
    .normalize(form)
    .replace(/\p{Mark}/gu, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSongSearchQuery(query: string) {
  const tokens = query
    .split(" ")
    .filter((token) => isMeaningfulSongSearch(token) || /^\p{Number}$/u.test(token))
    .slice(0, SONG_SEARCH_MAX_TOKENS);

  return [...new Set(tokens)];
}

export function tokenizeLegacySongSearchQuery(query: string) {
  return [...new Set(query.split(" ").filter(token => token.length >= 2).slice(0, SONG_SEARCH_MAX_TOKENS))];
}
