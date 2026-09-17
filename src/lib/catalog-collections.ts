export const CATALOG_COLLECTION_SECTIONS = [
  "top",
  "playlist",
  "style",
] as const;

export type CatalogCollectionSection =
  (typeof CATALOG_COLLECTION_SECTIONS)[number];

export type CatalogCollectionRule = {
  genre: string;
};

const PLAYLIST_FILTER_KEY_PATTERN = /^pl_[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STYLE_FILTER_KEY_PATTERN = /^st_[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isCatalogCollectionSection(
  value: string,
): value is CatalogCollectionSection {
  return CATALOG_COLLECTION_SECTIONS.some((section) => section === value);
}

export function isCatalogCollectionFilterKey(value: string) {
  return (
    PLAYLIST_FILTER_KEY_PATTERN.test(value) ||
    STYLE_FILTER_KEY_PATTERN.test(value)
  );
}

export function isPlaylistCollectionFilterKey(value: string) {
  return PLAYLIST_FILTER_KEY_PATTERN.test(value);
}

export function isStyleCollectionFilterKey(value: string) {
  return STYLE_FILTER_KEY_PATTERN.test(value);
}

export function parseCatalogCollectionRuleConfig(
  value: unknown,
): CatalogCollectionRule | null {
  if (!isRecord(value) || Object.keys(value).length !== 1) return null;

  const genre = typeof value.genre === "string" ? value.genre.trim() : "";
  if (
    genre.length === 0 ||
    genre.length > 100 ||
    /[\u0000-\u001F]/.test(genre)
  ) {
    return null;
  }

  return { genre: genre.toLocaleLowerCase("en-US") };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
