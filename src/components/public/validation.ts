export const PUBLIC_SEARCH_MIN_LENGTH = 2;

export function normalizePublicSearchTerm(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function canSearchPublicSongs(value: string) {
  return normalizePublicSearchTerm(value).length >= PUBLIC_SEARCH_MIN_LENGTH;
}

export function formatSongSource(source: "ising" | "karafun" | "manual") {
  const labels = {
    ising: "iSing",
    karafun: "KaraFun",
    manual: "Ręcznie",
  } as const;

  return labels[source];
}
