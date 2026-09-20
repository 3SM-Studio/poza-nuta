export const SONG_SEARCH_MAX_TOKENS = 16;

export function normalizeSongSearchText(input: string) {
  return normalizeAsciiSearchValue(input, "NFD");
}

export function normalizeSongSearchQuery(input: string) {
  return normalizeAsciiSearchValue(input, "NFKD");
}

function normalizeAsciiSearchValue(input: string, form: "NFD" | "NFKD") {
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
    .filter((token) => token.length >= 2)
    .slice(0, SONG_SEARCH_MAX_TOKENS);

  return [...new Set(tokens)];
}
