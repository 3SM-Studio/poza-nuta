import type { SessionSongDiscovery } from "./api";

export type SessionCatalogRoute =
  | { kind: "discovery" }
  | { kind: "genres" }
  | {
      kind: "catalog";
      heading: string;
      backLabel: string;
      fallbackHref: string;
      input: { genre?: string; hit?: boolean; duet?: boolean; sort?: "newest" };
      canonicalHref: string | null;
    };

type CatalogFilter =
  | { kind: "genre"; genre: string }
  | { kind: "hits" }
  | { kind: "newest" }
  | { kind: "duets" };

export function getSessionCatalogRoute({
  pathname,
  searchParams,
  sessionToken,
  discovery,
}: {
  pathname: string;
  searchParams: URLSearchParams;
  sessionToken: string;
  discovery?: SessionSongDiscovery;
}): SessionCatalogRoute {
  const sessionHref = `/s/${encodeURIComponent(sessionToken)}`;
  if (pathname.endsWith("/catalog/genres")) return { kind: "genres" };
  if (!pathname.endsWith("/catalog")) return { kind: "discovery" };

  const filter = parseCatalogFilter(searchParams);
  if (!filter) {
    return {
      kind: "catalog",
      heading: "Katalog",
      backLabel: "Wróć do odkrywania",
      fallbackHref: sessionHref,
      input: {},
      canonicalHref: null,
    };
  }

  const canonicalHref = buildSessionCatalogHref(sessionToken, filter);
  const isCanonical = searchParams.toString() === canonicalHref.split("?")[1];
  if (filter.kind === "genre") {
    const knownGenre = discovery?.genres.find((item) => item.value === filter.genre);
    return {
      kind: "catalog",
      heading: knownGenre?.label ?? filter.genre,
      backLabel: "Wróć do gatunków",
      fallbackHref: `${sessionHref}/catalog/genres`,
      input: { genre: filter.genre },
      canonicalHref: isCanonical ? null : canonicalHref,
    };
  }

  if (filter.kind === "hits") {
    return {
      kind: "catalog",
      heading: "Hity",
      backLabel: "Wróć do odkrywania",
      fallbackHref: sessionHref,
      input: { hit: true },
      canonicalHref: isCanonical ? null : canonicalHref,
    };
  }

  if (filter.kind === "duets") {
    return {
      kind: "catalog",
      heading: "Duety",
      backLabel: "Wróć do odkrywania",
      fallbackHref: sessionHref,
      input: { duet: true },
      canonicalHref: isCanonical ? null : canonicalHref,
    };
  }

  return {
    kind: "catalog",
    heading: "Najnowsze",
    backLabel: "Wróć do odkrywania",
    fallbackHref: sessionHref,
    input: { sort: "newest" },
    canonicalHref: isCanonical ? null : canonicalHref,
  };
}

export function buildSessionCatalogHref(
  sessionToken: string,
  filter: CatalogFilter,
) {
  const searchParams = new URLSearchParams();
  searchParams.set("filter", toCatalogFilterValue(filter));
  return `/s/${encodeURIComponent(sessionToken)}/catalog?${searchParams.toString()}`;
}

export function buildSessionGenreCatalogHref(sessionToken: string, genre: string) {
  const normalizedGenre = normalizeGenreUrlValue(genre);
  return normalizedGenre
    ? buildSessionCatalogHref(sessionToken, { kind: "genre", genre: normalizedGenre })
    : `/s/${encodeURIComponent(sessionToken)}/catalog`;
}

export function normalizeGenreUrlValue(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function parseCatalogFilter(searchParams: URLSearchParams): CatalogFilter | null {
  const canonicalFilter = searchParams.get("filter");
  if (canonicalFilter === "hits") return { kind: "hits" };
  if (canonicalFilter === "newest") return { kind: "newest" };
  if (canonicalFilter === "duets") return { kind: "duets" };
  if (canonicalFilter?.startsWith("genre:")) {
    const genre = normalizeGenreUrlValue(canonicalFilter.slice("genre:".length));
    return genre ? { kind: "genre", genre } : null;
  }

  const legacyGenre = searchParams.get("genre");
  if (legacyGenre) {
    const genre = normalizeGenreUrlValue(legacyGenre);
    return genre ? { kind: "genre", genre } : null;
  }
  if (searchParams.get("sort") === "newest") return { kind: "newest" };
  return null;
}

function toCatalogFilterValue(filter: CatalogFilter) {
  if (filter.kind === "genre") return `genre:${filter.genre}`;
  return filter.kind;
}
