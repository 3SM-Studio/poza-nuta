import { normalizeSearchText } from "../importers/ising/normalizeSearchText.ts";
import type { LocalSong } from "../songs/types.ts";

export type SearchOptions = {
  limit?: number;
  source?: "ising" | "karafun" | "all";
};

export type SearchResult = {
  song: LocalSong;
  score: number;
  matchedBy: Array<"exact" | "artist" | "title" | "searchText" | "contains" | "tokens" | "fuzzy">;
};

type Candidate = SearchResult & {
  tokenMatchRatio: number;
  sortLabel: string;
};

export function searchSongs(query: string, songs: LocalSong[], options: SearchOptions = {}): SearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = uniqueTokens(normalizedQuery);

  if (!normalizedQuery || tokens.length === 0) {
    return [];
  }

  const source = options.source ?? "all";
  const candidates = songs
    .filter((song) => source === "all" || song.source === source)
    .map((song) => scoreSong(song, normalizedQuery, tokens))
    .filter((result): result is Candidate => result !== null)
    .sort(compareCandidates);

  return candidates.slice(0, options.limit).map(({ tokenMatchRatio: _tokenMatchRatio, sortLabel: _sortLabel, ...result }) => result);
}

function scoreSong(song: LocalSong, normalizedQuery: string, queryTokens: string[]): Candidate | null {
  const normalizedArtist = song.normalizedArtist || normalizeSearchText(song.artist);
  const normalizedTitle = song.normalizedTitle || normalizeSearchText(song.title);
  const normalizedSubtitle = song.subtitle ? normalizeSearchText(song.subtitle) : "";
  const normalizedGenres = song.genres.map(normalizeSearchText).join(" ");
  const searchText = normalizeSearchText(song.searchText || [song.artist, song.title, song.subtitle, ...song.genres].filter(Boolean).join(" "));
  const artistTitle = normalizeSearchText(`${song.artist} ${song.title}`);
  const titleArtist = normalizeSearchText(`${song.title} ${song.artist}`);
  const searchableTokens = uniqueTokens([searchText, normalizedArtist, normalizedTitle, normalizedSubtitle, normalizedGenres].join(" "));
  const exactTokenMatches = queryTokens.filter((token) => searchableTokens.includes(token)).length;
  const fuzzyMatches = queryTokens.filter((token) => !searchableTokens.includes(token) && searchableTokens.some((candidate) => isFuzzyTokenMatch(token, candidate))).length;
  const tokenMatchRatio = exactTokenMatches / queryTokens.length;
  const matchedBy = new Set<SearchResult["matchedBy"][number]>();
  let score = 0;

  if (normalizedQuery === artistTitle || normalizedQuery === titleArtist) {
    score = Math.max(score, 100);
    matchedBy.add("exact");
  }

  if (normalizedQuery === normalizedTitle) {
    score = Math.max(score, 95);
    matchedBy.add("title");
  }

  if (normalizedQuery === normalizedArtist) {
    score = Math.max(score, 85);
    matchedBy.add("artist");
  }

  if (searchText.includes(normalizedQuery)) {
    score = Math.max(score, 75);
    matchedBy.add("searchText");
    matchedBy.add("contains");
  }

  if (exactTokenMatches === queryTokens.length) {
    score = Math.max(score, 65 + tokenMatchRatio * 10);
    matchedBy.add("tokens");
  } else if (exactTokenMatches > 0) {
    score = Math.max(score, 30 + tokenMatchRatio * 30);
    matchedBy.add("tokens");
  } else if (fuzzyMatches > 0) {
    score = Math.max(score, 20 + (fuzzyMatches / queryTokens.length) * 20);
    matchedBy.add("fuzzy");
  }

  if (score === 0) {
    return null;
  }

  return {
    song,
    score: Math.round(score),
    matchedBy: Array.from(matchedBy),
    tokenMatchRatio,
    sortLabel: normalizeSearchText(`${song.artist} ${song.title}`)
  };
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    b.score - a.score ||
    Number(b.song.isHit) - Number(a.song.isHit) ||
    b.tokenMatchRatio - a.tokenMatchRatio ||
    a.sortLabel.localeCompare(b.sortLabel, "pl")
  );
}

function uniqueTokens(value: string): string[] {
  return Array.from(new Set(normalizeSearchText(value).split(" ").filter(Boolean)));
}

function isFuzzyTokenMatch(queryToken: string, candidateToken: string): boolean {
  if (queryToken.length < 4 || candidateToken.length < 4) {
    return false;
  }

  const maxDistance = Math.max(queryToken.length, candidateToken.length) >= 7 ? 2 : 1;
  return levenshteinDistance(queryToken, candidateToken, maxDistance) <= maxDistance;
}

function levenshteinDistance(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[b.length];
}
