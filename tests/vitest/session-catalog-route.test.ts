import { describe, expect, it } from "vitest";

import {
  buildSessionGenreCatalogHref,
  getSessionCatalogRoute,
} from "@/components/public/session-catalog-route";

const token = "AbCdEfGhIjKlMnOpQrStUv";
const discovery = {
  genres: [{ value: "rock & roll", label: "Rock & Roll", count: 24 }],
  languages: [],
  features: { duetCount: 1, hitCount: 1, plusCount: 0 },
};

describe("session catalog route parser", () => {
  it.each([
    ["filter=hits", "Hity", { hit: true }],
    ["filter=newest", "Najnowsze", { sort: "newest" }],
    ["filter=duets", "Duety", { duet: true }],
  ] as const)("parses canonical %s", (query, heading, input) => {
    const route = parse(query);
    expect(route).toMatchObject({ kind: "catalog", heading, input, canonicalHref: null });
  });

  it("parses and retains a canonical genre value without a lossy slug", () => {
    const route = parse("filter=genre%3ARock%20%26%20Roll");
    expect(route).toMatchObject({
      kind: "catalog",
      heading: "Rock & Roll",
      input: { genre: "rock & roll" },
      canonicalHref: "/s/AbCdEfGhIjKlMnOpQrStUv/catalog?filter=genre%3Arock+%26+roll",
    });
  });

  it("canonicalizes legacy genre and newest URLs without changing their view", () => {
    expect(parse("genre=Rock")).toMatchObject({
      kind: "catalog",
      heading: "rock",
      input: { genre: "rock" },
      canonicalHref: "/s/AbCdEfGhIjKlMnOpQrStUv/catalog?filter=genre%3Arock",
    });
    expect(parse("sort=newest")).toMatchObject({
      kind: "catalog",
      heading: "Najnowsze",
      input: { sort: "newest" },
      canonicalHref: "/s/AbCdEfGhIjKlMnOpQrStUv/catalog?filter=newest",
    });
  });

  it("keeps invalid filters on the generic catalog without canonicalizing", () => {
    expect(parse("filter=genre%3A")).toMatchObject({
      kind: "catalog",
      heading: "Katalog",
      input: {},
      canonicalHref: null,
    });
    expect(parse("filter=unknown")).toMatchObject({ kind: "catalog", canonicalHref: null });
  });

  it.each([
    "Rock",
    "Rock & Roll",
    "Rock 'n Roll",
    "R&B",
    "R+B",
    "Pop/Rock",
    "Żółć",
    "Rock (Classic)",
  ])("encodes genre values through URLSearchParams: %s", (genre) => {
    const href = buildSessionGenreCatalogHref(token, genre);
    const url = new URL(href, "https://example.test");
    expect(url.searchParams.get("filter")).toBe(
      `genre:${genre.trim().toLocaleLowerCase("en-US")}`,
    );
  });
});

function parse(query: string) {
  return getSessionCatalogRoute({
    pathname: `/s/${token}/catalog`,
    searchParams: new URLSearchParams(query),
    sessionToken: token,
    discovery,
  });
}
